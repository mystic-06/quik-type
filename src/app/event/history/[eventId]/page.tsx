"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Medal, Trophy } from "lucide-react";
import { eventFetch } from "@/lib/event";
import ProfileAvatar from "@/components/ProfileAvatar";

interface EventDetail {
  id: string;
  title: string;
  status: "lobby" | "open" | "closed";
  durationSeconds: number;
  createdAt: number | null;
  participantCount: number;
  attemptsCompleted: number;
  leaderboard: { id: string; displayName: string; pictureUrl?: string | null; wpm: number; accuracy: number; attempts: number; rank: number }[];
  participants: {
    id: string;
    displayName: string;
    pictureUrl?: string | null;
    invalidated: boolean;
    activeAttempt: boolean;
    attempts: { id: string; result: { wpm: number; accuracy: number; charactersTyped: number; endedByWindow: boolean } | null; eligible: boolean }[];
  }[];
}

export default function EventHistoryDetailPage() {
  const params = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    eventFetch<{ event: EventDetail }>(`/event/history/${encodeURIComponent(params.eventId)}`)
      .then(result => { if (alive) setEvent(result.event); })
      .catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : "Could not load event results."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [params.eventId]);

  return (
    <div className="min-h-[75vh] py-8 animate-fade-in-up">
      <div className="max-w-6xl mx-auto space-y-6">
        <a href="/event/history" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text)]"><ArrowLeft className="w-4 h-4" />All events</a>
        {loading && <p className="text-center text-[var(--text-muted)] py-10">Loading event results…</p>}
        {error && <section className="nb-card p-8 text-center"><h1 className="text-2xl font-black">Could not load event</h1><p className="text-[var(--danger)] mt-2">{error}</p></section>}
        {event && <>
          <header className="nb-card p-6 md:p-8">
            <p className="text-[var(--ts-xs)] font-bold uppercase tracking-widest text-[var(--text-muted)]">Event results · {event.status}</p>
            <h1 className="text-3xl font-black mt-1">{event.title}</h1>
            <p className="text-[var(--text-secondary)] mt-2">{event.createdAt ? new Date(event.createdAt).toLocaleString() : "Date unavailable"} · {event.durationSeconds / 60} minute window · {event.participantCount} participants · {event.attemptsCompleted} attempts</p>
          </header>

          <section className="nb-card p-5 md:p-6">
            <div className="flex items-center gap-2 mb-4"><Trophy className="w-5 h-5 text-[var(--secondary)]" /><h2 className="text-xl font-black">{event.status === "closed" ? "Final leaderboard" : "Current leaderboard"}</h2></div>
            {event.leaderboard.length ? <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b-2 border-[var(--border)] text-xs uppercase text-[var(--text-muted)]"><th className="py-3 pr-3">Rank</th><th className="py-3 pr-3">Participant</th><th className="py-3 pr-3">WPM</th><th className="py-3 pr-3">Accuracy</th><th className="py-3">Attempts</th></tr></thead><tbody>{event.leaderboard.map(row => <tr key={row.id} className="border-b border-[var(--border)]"><td className="py-3 pr-3 font-mono font-black">{row.rank <= 3 ? <Medal className="w-5 h-5 inline text-[var(--secondary)]" /> : `#${row.rank}`}</td><td className="py-3 pr-3"><span className="inline-flex items-center gap-2 font-bold"><ProfileAvatar name={row.displayName} pictureUrl={row.pictureUrl} className="w-8 h-8 text-[10px]" />{row.displayName}</span></td><td className="py-3 pr-3 font-mono font-bold">{row.wpm}</td><td className="py-3 pr-3 font-mono">{row.accuracy}%</td><td className="py-3">{row.attempts}</td></tr>)}</tbody></table></div> : <p className="text-sm text-[var(--text-muted)] py-6 text-center">No eligible scores yet.</p>}
          </section>

          <section className="nb-card p-5 md:p-6">
            <h2 className="text-xl font-black mb-4">Participants and attempts</h2>
            {event.participants.length ? <div className="space-y-3">{event.participants.map(person => <article key={person.id} className="border-2 border-[var(--border)] rounded-md p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="inline-flex items-center gap-2 font-black"><ProfileAvatar name={person.displayName} pictureUrl={person.pictureUrl} className="w-8 h-8 text-[10px]" />{person.displayName}{person.invalidated && <span className="nb-badge ml-2 bg-[var(--danger)] text-white">Removed</span>}</h3>{person.activeAttempt && <span className="nb-badge bg-[var(--surface-alt)]">Attempt in progress</span>}</div>
              {person.attempts.length ? <div className="mt-3 space-y-2">{person.attempts.map((attempt, index) => <div key={attempt.id} className="flex flex-wrap items-center justify-between gap-2 text-sm border-t border-[var(--border)] pt-2"><span>Attempt {index + 1}<span className={`nb-badge ml-2 ${attempt.eligible ? "bg-[var(--success)] text-white" : "bg-[var(--surface-alt)]"}`}>{attempt.eligible ? "Eligible" : "Ineligible"}</span>{attempt.result?.endedByWindow && <span className="text-[var(--text-muted)] ml-2">Stopped at event cutoff</span>}</span><span className="font-mono font-bold">{attempt.result ? `${attempt.result.wpm} WPM · ${attempt.result.accuracy}% · ${attempt.result.charactersTyped} characters` : "No score recorded"}</span></div>)}</div> : <p className="text-sm text-[var(--text-muted)] mt-2">No completed attempts.</p>}
            </article>)}</div> : <p className="text-sm text-[var(--text-muted)]">No participants joined this event.</p>}
          </section>
        </>}
      </div>
    </div>
  );
}
