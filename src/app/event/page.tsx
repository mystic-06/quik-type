"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { ArrowRight, CheckCircle2, LockKeyhole, Medal, RefreshCw, Trophy, UserRound, Wifi, WifiOff } from "lucide-react";
import TypingArea from "@/components/TypingArea";
import ProfileAvatar from "@/components/ProfileAvatar";
import { EVENT_API_URL, EventState, eventFetch, formatRemaining, MAX_EVENT_ATTEMPTS } from "@/lib/event";

interface User { id: string; displayName: string; pictureUrl: string | null; isEventAdmin: boolean }
interface Attempt { id: string; text: string; durationSeconds: number; closesAt: number; startedAt: number; typed?: string }
interface Participant {
  id: string; displayName: string; invalidated: boolean; invalidationReason: string | null;
  attempts: { id: string; result: { wpm: number; accuracy: number; charactersTyped: number; endedByWindow: boolean } | null; eligible: boolean; invalidationReason: string | null }[];
  activeAttempt: { id: string; typedCharacters: number; startedAt: number } | null;
  best: { wpm: number; accuracy: number; rank: number } | null;
}

export default function EventPage() {
  const [user, setUser] = useState<User | null>(null);
  const [event, setEvent] = useState<EventState | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [testTime, setTestTime] = useState(60);
  const [testActive, setTestActive] = useState(false);
  const finishAttemptDisplay = useCallback(() => setTestActive(false), []);
  const socketRef = useRef<Socket | null>(null);
  const eventRef = useRef<EventState | null>(null);
  const attemptRef = useRef<Attempt | null>(null);
  const userRef = useRef(false);
  const joinedEventRef = useRef(false);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingProgress = useRef("");

  const refreshParticipant = useCallback(async () => {
    try {
      const result = await eventFetch<{ participant: Participant }>("/event/participant/state");
      setParticipant(result.participant);
      if (!result.participant.activeAttempt && attemptRef.current && result.participant.attempts.some(item => item.id === attemptRef.current?.id)) {
        attemptRef.current = null;
        setAttempt(null);
        setTestActive(false);
      }
    } catch { /* The participant has not joined the event yet. */ }
  }, []);

  useEffect(() => {
    let alive = true;
    const profileRequest = eventFetch<User>("/auth/me").catch(() => null);
    void profileRequest.then(profile => {
      if (!alive) return;
      setUser(profile);
      userRef.current = !!profile;
    });
    Promise.all([
      profileRequest,
      eventFetch<{ event: EventState | null }>("/event/state"),
    ]).then(([profile, state]) => {
      if (!alive) return;
      setUser(profile);
      userRef.current = !!profile;
      setEvent(state.event);
      eventRef.current = state.event;
      const socket = io(EVENT_API_URL, { withCredentials: true });
      socketRef.current = socket;
      socket.on("connect", () => {
        setConnected(true);
        if (profile && eventRef.current) { joinedEventRef.current = true; socket.emit("event-join"); }
      });
      socket.on("disconnect", () => setConnected(false));
      socket.on("connect_error", () => setError("Could not connect to the event server. Please retry."));
      socket.on("event-joined", (payload: { event: EventState; participant: Participant; attempt: Attempt | null }) => {
        setEvent(payload.event);
        setParticipant(payload.participant);
        eventRef.current = payload.event;
        joinedEventRef.current = true;
        if (payload.attempt) {
          setAttempt(payload.attempt);
          attemptRef.current = payload.attempt;
          setTestTime(payload.attempt.durationSeconds);
          setTestActive(true);
        }
        setBusy(false);
      });
      socket.on("event-state-changed", (nextEvent: EventState) => {
        setEvent(nextEvent);
        const previous = eventRef.current;
        eventRef.current = nextEvent;
        if (previous && previous.id !== nextEvent.id) joinedEventRef.current = false;
        if (profile && !joinedEventRef.current) { joinedEventRef.current = true; socket.emit("event-join"); }
        if (previous && nextEvent.attemptsCompleted > previous.attemptsCompleted) void refreshParticipant();
        if (nextEvent.status === "closed") {
          setTestActive(false);
          setTestTime(0);
          void refreshParticipant();
        }
      });
      socket.on("event-attempt-started", (nextAttempt: Attempt) => {
        const attemptEndsAt = Math.min(nextAttempt.startedAt + nextAttempt.durationSeconds * 1000, nextAttempt.closesAt);
        setTestTime(Math.max(1, Math.ceil((attemptEndsAt - Date.now()) / 1000)));
        setAttempt(nextAttempt);
        attemptRef.current = nextAttempt;
        setTestActive(true);
        setBusy(false);
        setError("");
      });
      socket.on("event-attempt-saved", (nextParticipant: Participant) => {
        setParticipant(nextParticipant);
        setTestActive(false);
        setBusy(false);
      });
      socket.on("event-error", (message: string) => {
        if (message === "No event has been created") joinedEventRef.current = false;
        setError(message);
        setBusy(false);
      });
    }).catch(reason => {
      if (alive) setError(reason instanceof Error ? reason.message : "Could not load the event.");
    }).finally(() => {
      if (alive) {
        setAuthChecked(true);
        setBusy(false);
      }
    });
    const clockTimer = setInterval(() => setClock(Date.now()), 1000);
    const timer = setInterval(() => {
      void eventFetch<{ event: EventState | null }>("/event/state").then(result => {
        if (!alive) return;
        const previous = eventRef.current;
        eventRef.current = result.event;
        setEvent(result.event);
        if (result.event && previous && previous.id !== result.event.id) joinedEventRef.current = false;
        if (userRef.current && result.event && !joinedEventRef.current && socketRef.current?.connected) {
          joinedEventRef.current = true;
          socketRef.current.emit("event-join");
        }
      }).catch(() => {});
      if (userRef.current) void refreshParticipant();
    }, 2000);
    return () => {
      alive = false;
      clearInterval(clockTimer);
      clearInterval(timer);
      if (progressTimer.current) clearTimeout(progressTimer.current);
      socketRef.current?.disconnect();
    };
  }, [refreshParticipant]);

  const startAttempt = () => {
    setAttempt(null);
    attemptRef.current = null;
    setBusy(true);
    socketRef.current?.emit("event-attempt-start");
  };

  const reportProgress = useCallback((typed: string) => {
    pendingProgress.current = typed;
    if (progressTimer.current) clearTimeout(progressTimer.current);
    progressTimer.current = setTimeout(() => {
      if (attempt && socketRef.current?.connected) {
        socketRef.current.emit("event-attempt-progress", { attemptId: attempt.id, typed: pendingProgress.current });
      }
    }, 150);
  }, [attempt]);

  const canStart = !!event && event.status === "open" && !!participant && !participant.invalidated && !participant.activeAttempt && !attempt && connected && (event.closesAt || 0) > clock;
  const participantAttemptsUsed = participant ? participant.attempts.length + Number(Boolean(participant.activeAttempt)) : 0;
  return (
    <div className="min-h-[75vh] py-8 animate-fade-in-up">
      <div className="max-w-6xl mx-auto space-y-6">
        <section className="relative overflow-hidden nb-card p-6 md:p-10 grid lg:grid-cols-[minmax(0,1fr)_300px] gap-8 items-center">
          <div className="absolute -right-16 -top-24 w-72 h-72 rounded-full border-[28px] border-[var(--primary)]/30 pointer-events-none" />
          <div className="relative">
            <h1 className="text-3xl md:text-5xl font-black leading-tight max-w-3xl">{event?.title || "Speed Typing Challenge"}</h1>
            <p className="text-[var(--text-secondary)] mt-4 max-w-2xl md:text-lg">Make every second count. You get up to {MAX_EVENT_ATTEMPTS} 60 second attempts during the event window. Your best score counts with at least 80% accuracy.</p>
            {user?.isEventAdmin && <a className="nb-btn nb-btn-ghost text-sm mt-5" href="/event/admin">Admin control panel <ArrowRight className="w-4 h-4" /></a>}
          </div>
          <div className="relative nb-card-primary p-5 md:p-6 text-center lg:min-h-48 flex flex-col justify-center">
            <p className="text-[10px] font-black uppercase tracking-[0.2em]">Event status</p>
            <p className="text-2xl md:text-3xl font-black uppercase mt-2">{event?.status || (busy ? "Loading" : "Not set up")}</p>
            {event?.status === "open" && event.closesAt ? <><p className="text-xs font-bold uppercase tracking-widest mt-4">Time remaining</p><p className="font-mono text-4xl font-black mt-1">{formatRemaining(event.closesAt - clock)}</p></> : <p className="text-sm text-[var(--text-secondary)] mt-3">{event?.status === "lobby" ? "Get ready. The competition starts soon." : event?.status === "closed" ? "The competition has ended." : "Check back when the organizer opens the event."}</p>}
          </div>
        </section>

        {error && <div role="alert" className="nb-card p-4 border-[var(--danger)] text-[var(--danger)] font-semibold">{error}</div>}

        {!authChecked ? (
          <section className="nb-card p-8 text-center text-[var(--text-secondary)]" role="status">Checking your FOSS sign-in…</section>
        ) : !user ? (
          <section className="nb-card p-6 md:p-9 max-w-4xl mx-auto grid md:grid-cols-[1fr_auto] gap-8 items-center border-t-8 border-t-[var(--secondary)]">
            <div>
              <span className="nb-badge bg-[var(--surface-alt)] mb-4"><LockKeyhole className="w-3 h-3" /> PARTICIPANT ACCESS</span>
              <h2 className="text-2xl md:text-3xl font-black mb-2">Ready to take your shot?</h2>
              <p className="text-[var(--text-secondary)] max-w-xl">Sign in with your FOSS account to join the event. Your verified profile name will appear on the leaderboard.</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2 mt-5 text-sm font-bold text-[var(--text-secondary)]"><span className="inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[var(--success)]" />Multiple attempts</span><span className="inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[var(--success)]" />Best score counts</span></div>
            </div>
            <a href={`${EVENT_API_URL}/auth/login`} className="nb-btn nb-btn-primary justify-center px-6 py-4 text-base whitespace-nowrap">Sign in with FOSS <ArrowRight className="w-4 h-4" /></a>
          </section>
        ) : !event ? (
          <section className="nb-card p-10 text-center"><h2 className="text-xl font-black">The event is not set up yet</h2><p className="text-[var(--text-secondary)] mt-2">The organizer will open the lobby shortly.</p></section>
        ) : (
          <div className="space-y-6">
            <section className="space-y-5">
              {event.status === "lobby" && <div className="nb-card p-6 flex items-center gap-4"><RefreshCw className="w-6 h-6 animate-spin text-[var(--secondary)]" /><div><h2 className="font-black text-lg">Lobby is open</h2><p className="text-[var(--text-secondary)]">You’re checked in as <strong>{user.displayName}</strong>. The organizer will start the timed window.</p></div></div>}
              {event.status === "closed" && <div className="nb-card-primary p-6"><h2 className="text-xl font-black">Event closed · Final standings</h2><p className="text-[var(--text-secondary)] mt-1">Attempts in progress were stopped at the cutoff and scored from the latest saved typing.</p></div>}
              {attempt && <div className="nb-card p-5"><h2 className="text-lg font-black mb-4">Attempt in progress</h2><TypingArea key={attempt.id} time={testTime} testContent={attempt.text} initialInput={attempt.typed || ""} isTestActive={testActive} onTestStart={() => {}} onTestFinish={finishAttemptDisplay} onTryAgain={() => {}} onProgressChange={reportProgress} allowRetry={false} fullWidth /></div>}
              {participant && <div className="nb-card p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"><div><p className="text-[var(--ts-xs)] font-bold uppercase tracking-wider text-[var(--text-muted)]">Your standing</p><p className="text-2xl font-black mt-1">{participant.best ? `#${participant.best.rank}` : "Unranked"}{participant.best && <span className="text-base font-semibold text-[var(--text-secondary)] ml-3">{participant.best.wpm} WPM · {participant.best.accuracy}% accuracy</span>}</p><p className="text-sm text-[var(--text-secondary)] mt-1">{participantAttemptsUsed} of {MAX_EVENT_ATTEMPTS} attempts used</p></div><button className="nb-btn nb-btn-primary disabled:opacity-50 disabled:cursor-not-allowed" onClick={startAttempt} disabled={event.status !== "open" || !canStart || busy} title={event.status === "lobby" ? "The host has not opened the event yet." : undefined}>{busy ? "Loading…" : event.status === "lobby" ? "Waiting for event to start" : event.status === "closed" ? "Event ended" : participant.attempts.length >= MAX_EVENT_ATTEMPTS ? "All attempts used" : participant.activeAttempt ? "Attempt running" : "Start an attempt"}<ArrowRight className="w-4 h-4" /></button></div>}
              {participant?.invalidated && <div className="nb-card p-4 text-[var(--danger)]"><p className="font-bold">Your event entry has been removed.</p>{participant.invalidationReason && <p className="mt-1">Reason: {participant.invalidationReason}</p>}<p className="mt-1">Contact the organizer if you believe this is an error.</p></div>}
              {participant?.attempts.length ? <section className="nb-card p-5"><h2 className="font-black text-lg mb-3">Your attempts</h2><div className="space-y-2">{participant.attempts.map((item, index) => <div key={item.id} className="flex justify-between items-center border-2 border-[var(--border)] rounded-md p-3"><div><span className="font-bold">Attempt {index + 1}</span><span className={`nb-badge ml-2 ${item.eligible ? "bg-[var(--success)] text-white" : "bg-[var(--surface-alt)]"}`}>{item.eligible ? "Counts" : "Below 80% / invalid"}</span></div><span className="font-mono font-bold">{item.result?.wpm ?? 0} WPM · {item.result?.accuracy ?? 0}%</span></div>)}</div>{participant.attempts.length >= MAX_EVENT_ATTEMPTS && <p className="text-sm text-[var(--text-muted)] mt-3">You’ve used all {MAX_EVENT_ATTEMPTS} attempts for this event.</p>}</section> : null}
              {event.status === "open" && !participant && <div className="nb-card p-5 flex items-center gap-3"><UserRound className="w-5 h-5" /><span>Joining the live event…</span></div>}
            </section>

            <section className="nb-card p-5"><div className="flex items-center gap-2 mb-4"><Trophy className="w-5 h-5 text-[var(--secondary)]" /><h2 className="text-lg font-black">{event.status === "closed" ? "Final leaderboard" : "Live leaderboard"}</h2></div><p className="text-xs text-[var(--text-muted)] mb-4">One best eligible score per participant · WPM, then accuracy</p><div className="space-y-2">{event.leaderboard.length ? event.leaderboard.slice(0, 100).map(row => <div key={row.id} className={`flex items-center justify-between gap-3 p-3 rounded-md border-2 border-[var(--border)] ${row.id === participant?.id ? "bg-[var(--primary)]/30" : "bg-white"}`}><div className="flex items-center gap-3 min-w-0"><span className="font-mono font-black w-8 text-center">{row.rank <= 3 ? <Medal className="w-5 h-5 inline" /> : `#${row.rank}`}</span><ProfileAvatar name={row.displayName} pictureUrl={row.pictureUrl} className="w-8 h-8 text-[10px]" /><span className="font-bold truncate">{row.displayName}{row.id === participant?.id && <small className="ml-2 text-[var(--secondary)]">You</small>}</span></div><span className="font-mono font-bold whitespace-nowrap">{row.wpm} <small className="text-[var(--text-muted)]">{row.accuracy}%</small></span></div>) : <p className="text-sm text-[var(--text-muted)] py-6 text-center">No eligible scores yet. Be first on the board.</p>}</div><div className="mt-4 pt-3 border-t-2 border-[var(--border)] flex justify-between text-xs font-bold text-[var(--text-muted)]"><span>{event.participantCount} players</span><span>{event.attemptsCompleted} attempts</span></div></section>
          </div>
        )}
        {authChecked && user && busy && !event && <p className="text-center text-[var(--text-muted)]">Loading event…</p>}
      </div>
    </div>
  );
}
