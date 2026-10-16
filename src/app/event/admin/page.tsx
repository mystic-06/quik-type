"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Ban, Clock3, Play, Square, UserRoundCheck, Users } from "lucide-react";
import { EventState, eventFetch, formatRemaining } from "@/lib/event";
import ProfileAvatar from "@/components/ProfileAvatar";

interface AdminParticipant {
  id: string;
  displayName: string;
  pictureUrl: string | null;
  invalidated: boolean;
  invalidationReason: string | null;
  isOnline: boolean;
  attempts: { id: string; result: { wpm: number; accuracy: number; charactersTyped: number; endedByWindow: boolean } | null; eligible: boolean; invalidationReason: string | null }[];
  activeAttempt: { id: string; typedCharacters: number; startedAt: number } | null;
  best: { wpm: number; accuracy: number; rank: number } | null;
}
interface AdminEvent extends EventState {
  participants: AdminParticipant[];
  invalidations: { participantId: string; attemptId: string | null; action?: "reinstated"; reason: string; at: number; by: string }[];
}
interface AdminParticipant {
  oidcSubject: string;
}

export default function EventAdminPage() {
  const [event, setEvent] = useState<AdminEvent | null>(null);
  const [duration, setDuration] = useState(900);
  const [title, setTitle] = useState("QuikType Speed Typing Event");
  const [busy, setBusy] = useState(false);
  const [loadingState, setLoadingState] = useState(true);
  const [creatingNextEvent, setCreatingNextEvent] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now());

  const loadState = useCallback(async () => {
    try {
      const result = await eventFetch<{ event: AdminEvent | null }>("/event/admin/state");
      setEvent(result.event);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load event admin controls."); }
    finally { setLoadingState(false); }
  }, []);

  useEffect(() => {
    void loadState();
    const poll = setInterval(() => { void loadState(); setClock(Date.now()); }, 2000);
    return () => clearInterval(poll);
  }, [loadState]);

  const action = async (path: string, body?: object) => {
    setBusy(true);
    setError("");
    try {
      const result = await eventFetch<{ event: AdminEvent }>(path, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) });
      setEvent(result.event);
      if (path === "/event/admin/create") setCreatingNextEvent(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Action failed."); }
    finally { setBusy(false); }
  };

  const invalidate = (participantId: string, attemptId?: string) => {
    const reason = window.prompt(attemptId ? "Reason for invalidating this attempt:" : "Reason for removing this participant:");
    if (!reason?.trim()) return;
    void action("/event/admin/invalidate", { participantId, ...(attemptId ? { attemptId } : {}), reason });
  };

  const reinstate = (participantId: string, displayName: string) => {
    if (window.confirm(`Reinstate ${displayName}? Their previous attempts will remain ineligible.`)) {
      void action("/event/admin/reinstate", { participantId });
    }
  };

  const stopEvent = () => {
    if (window.confirm("Stop the event now? Active attempts will be scored from their latest saved typing.")) {
      void action("/event/admin/stop");
    }
  };

  const remaining = event?.closesAt ? Math.max(0, event.closesAt - clock) : 0;

  return (
    <div className="min-h-[75vh] py-8 animate-fade-in-up">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><a href="/event" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text)]"><ArrowLeft className="w-4 h-4" />Back to event</a><a href="/event/history" className="text-sm font-bold text-[var(--secondary)] hover:underline">Events</a></div>
        <header className="nb-card p-6 md:p-8 flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div><p className="text-[var(--ts-xs)] font-bold uppercase tracking-widest text-[var(--text-muted)]">Private controls</p><h1 className="text-3xl font-black mt-1">Event admin</h1><p className="text-[var(--text-secondary)] mt-2">Monitor check-ins, control the timed window, and record any result decisions.</p></div>
          {event && <div className="nb-card-primary p-4 text-center"><p className="text-[10px] font-bold uppercase">Event status</p><p className="text-xl font-black uppercase">{event.status}</p>{event.status === "open" && <p className="font-mono font-black">{formatRemaining(remaining)}</p>}</div>}
        </header>

        {error && <div role="alert" className="nb-card p-4 text-[var(--danger)] font-bold">{error}{error === "Sign in required" && <a className="nb-btn nb-btn-primary ml-4" href={`${process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001"}/auth/login`}>Sign in</a>}</div>}

        {loadingState ? (
          <section className="nb-card p-8 text-center text-[var(--text-secondary)]" role="status">Loading event controls…</section>
        ) : !event && error ? null : !event || (event.status === "closed" && creatingNextEvent) ? (
          <section className="nb-card p-6 md:p-8 max-w-2xl">
            <h2 className="text-xl font-black mb-5">{event ? "Create another event" : "Create an event lobby"}</h2>
            <label className="block text-sm font-bold mb-2">Event name</label>
            <input className="nb-input mb-5" maxLength={80} value={title} onChange={e => setTitle(e.target.value)} />
            <label className="block text-sm font-bold mb-2">Open window</label>
            <div className="flex gap-3 mb-6">{[600, 900].map(seconds => <button key={seconds} onClick={() => setDuration(seconds)} className={`nb-btn ${duration === seconds ? "nb-btn-primary" : "nb-btn-ghost"}`}>{seconds / 60} minutes</button>)}</div>
            <div className="flex gap-3"><button className="nb-btn nb-btn-primary" disabled={busy} onClick={() => void action("/event/admin/create", { title: title.trim() || "QuikType Speed Typing Event", durationSeconds: duration })}>Create lobby</button>{event && <button className="nb-btn nb-btn-ghost" disabled={busy} onClick={() => setCreatingNextEvent(false)}>Cancel</button>}</div>
          </section>
        ) : (
          <>
            <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="nb-card p-5"><Users className="w-5 h-5 text-[var(--secondary)]" /><p className="text-2xl font-black mt-2">{event.participantCount}</p><p className="text-xs font-bold uppercase text-[var(--text-muted)]">Checked in</p></div>
              <div className="nb-card p-5"><Play className="w-5 h-5 text-[var(--secondary)]" /><p className="text-2xl font-black mt-2">{event.activeAttempts}</p><p className="text-xs font-bold uppercase text-[var(--text-muted)]">Active attempts</p></div>
              <div className="nb-card p-5"><Clock3 className="w-5 h-5 text-[var(--secondary)]" /><p className="text-2xl font-black mt-2">{event.attemptsCompleted}</p><p className="text-xs font-bold uppercase text-[var(--text-muted)]">Attempts scored</p></div>
              <div className="nb-card p-5"><AlertTriangle className="w-5 h-5 text-[var(--secondary)]" /><p className="text-2xl font-black mt-2">{event.invalidations.length}</p><p className="text-xs font-bold uppercase text-[var(--text-muted)]">Recorded decisions</p></div>
            </section>

            <section className="nb-card p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div><h2 className="text-lg font-black">{event.title}</h2><p className="text-sm text-[var(--text-secondary)]">{event.durationSeconds / 60} minute window · 80% minimum accuracy · WPM then accuracy</p></div>
              <div className="flex gap-3">{event.status === "lobby" && <button className="nb-btn nb-btn-primary" disabled={busy} onClick={() => void action("/event/admin/open")}><Play className="w-4 h-4" />Open event now</button>}{event.status === "open" && <button className="nb-btn nb-btn-ghost text-[var(--danger)]" disabled={busy} onClick={stopEvent}><Square className="w-4 h-4" />Stop event</button>}{event.status === "closed" && <button className="nb-btn nb-btn-primary" onClick={() => { setTitle("QuikType Speed Typing Event"); setDuration(900); setCreatingNextEvent(true); }}>Create another event</button>}</div>
            </section>

            <section className="nb-card p-5">
              <div className="flex items-center justify-between gap-3 mb-4"><h2 className="text-xl font-black">Participant monitor</h2><span className="nb-badge bg-[var(--surface-alt)]">Auto refresh · 2 sec</span></div>
              {event.participants.length ? <div className="space-y-3">{event.participants.map(person => <article key={person.id} className="border-2 border-[var(--border)] rounded-md p-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div><p className="flex flex-wrap items-center gap-2 font-black"><ProfileAvatar name={person.displayName} pictureUrl={person.pictureUrl} className="w-8 h-8 text-[10px]" />{person.displayName}<span className={`nb-badge ${person.isOnline ? "bg-[var(--success)] text-white" : "bg-[var(--surface-alt)]"}`}>{person.isOnline ? "Online" : "Offline"}</span>{person.invalidated && <span className="nb-badge bg-[var(--danger)] text-white">Removed</span>}{person.best && <span className="text-sm font-bold text-[var(--secondary)]">#{person.best.rank} · {person.best.wpm} WPM · {person.best.accuracy}%</span>}</p><p className="text-[11px] font-mono text-[var(--text-muted)] break-all">{person.oidcSubject}</p><p className="text-xs text-[var(--text-secondary)] mt-1">{person.activeAttempt ? `Typing · ${person.activeAttempt.typedCharacters} characters saved` : "No active attempt"} · {person.attempts.length} completed</p>{person.invalidationReason && <p className="text-xs text-[var(--danger)] mt-1">Removal reason: {person.invalidationReason}</p>}</div>
                  {person.invalidated ? <button className="nb-btn nb-btn-ghost text-xs" disabled={busy} onClick={() => reinstate(person.oidcSubject, person.displayName)}><UserRoundCheck className="w-4 h-4" />Reinstate participant</button> : <button className="nb-btn nb-btn-ghost text-xs" disabled={busy} onClick={() => invalidate(person.oidcSubject)}><Ban className="w-4 h-4" />Remove participant</button>}
                </div>
                {person.attempts.length > 0 && <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-2">{person.attempts.map((attempt, index) => <div key={attempt.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>Attempt {index + 1}: <strong>{attempt.result?.wpm ?? 0} WPM</strong>, {attempt.result?.accuracy ?? 0}% accuracy {attempt.result?.endedByWindow && "· stopped at event cutoff"}</span><span className="flex items-center gap-2"><span className={`nb-badge ${attempt.eligible ? "bg-[var(--success)] text-white" : "bg-[var(--surface-alt)]"}`}>{attempt.eligible ? "Eligible" : attempt.invalidationReason || "Ineligible"}</span>{attempt.eligible && <button onClick={() => invalidate(person.oidcSubject, attempt.id)} className="text-xs underline font-bold">Invalidate</button>}</span></div>)}</div>}
              </article>)}</div> : <p className="text-[var(--text-secondary)] py-6 text-center">No participants checked in yet.</p>}
            </section>

            {event.invalidations.length > 0 && <section className="nb-card p-5"><h2 className="font-black text-lg mb-3">Decision history</h2><div className="space-y-2">{event.invalidations.map((decision, index) => <p key={`${decision.at}-${index}`} className="text-sm"><strong>{new Date(decision.at).toLocaleTimeString()}</strong> · {decision.action === "reinstated" ? "Participant reinstated" : decision.attemptId ? "Attempt invalidated" : "Participant removed"} · {decision.reason} <span className="text-[var(--text-muted)]">(by {decision.by})</span></p>)}</div></section>}
          </>
        )}
      </div>
    </div>
  );
}
