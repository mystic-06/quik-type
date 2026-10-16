"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Medal, Trophy } from "lucide-react";
import { eventFetch } from "@/lib/event";
import ProfileAvatar from "@/components/ProfileAvatar";

interface EventSummary {
  id: string;
  current: boolean;
  title: string;
  durationSeconds: number;
  status: "lobby" | "open" | "closed";
  createdAt: number | null;
  participantCount: number;
  attemptsCompleted: number;
  leaderboard: { id: string; displayName: string; pictureUrl?: string | null; wpm: number; accuracy: number; rank: number }[];
}

export default function EventHistoryPage() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const orderedEvents = [...events].sort((a, b) => Number(b.current) - Number(a.current));

  useEffect(() => {
    let alive = true;
    eventFetch<{ events: EventSummary[] }>("/event/history")
      .then(result => { if (alive) setEvents(result.events); })
      .catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : "Could not load events."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="min-h-[75vh] py-8 animate-fade-in-up">
      <div className="max-w-6xl mx-auto space-y-6">
        <a href="/event" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text)]"><ArrowLeft className="w-4 h-4" />Back to event</a>
        <header className="nb-card p-6 md:p-8">
          <p className="text-[var(--ts-xs)] font-bold uppercase tracking-widest text-[var(--text-muted)]">Admin control panel</p>
          <h1 className="text-3xl font-black mt-1">Events</h1>
          <p className="text-[var(--text-secondary)] mt-2">Browse current standings and results from previous events.</p>
        </header>

        {error && <div role="alert" className="nb-card p-4 text-[var(--danger)] font-bold">{error}</div>}
        {loading ? <p className="text-center text-[var(--text-muted)] py-10">Loading events…</p> : events.length === 0 ? (
          <section className="nb-card p-10 text-center"><Trophy className="w-8 h-8 mx-auto mb-3 text-[var(--secondary)]" /><h2 className="text-xl font-black">No events yet</h2><p className="text-[var(--text-secondary)] mt-2">Events will appear here once the organizer creates one.</p></section>
        ) : (
          <div className="space-y-4">{orderedEvents.map(event => {
            const isCurrent = event.current;
            const cardContent = <>
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-black">{event.title}</h2><span className={`nb-badge ${isCurrent ? "bg-[var(--secondary)] text-[var(--text)]" : "bg-[var(--surface-alt)]"}`}>{event.current ? `Current · ${event.status}` : `Previous · ${event.status}`}</span></div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-[var(--text-secondary)]">
                    {event.createdAt && <span className="inline-flex items-center gap-1"><CalendarDays className="w-4 h-4" />{new Date(event.createdAt).toLocaleString()}</span>}
                    <span>{event.durationSeconds / 60} minute window</span><span>{event.participantCount} participants</span><span>{event.attemptsCompleted} attempts</span>
                  </div>
                </div>
                {isCurrent ? <span className="nb-btn nb-btn-primary shrink-0">Admin controls <ArrowRight className="w-4 h-4" /></span> : <a className="nb-btn nb-btn-primary shrink-0" href={`/event/history/${encodeURIComponent(event.id)}`}>View scores <ArrowRight className="w-4 h-4" /></a>}
              </div>
              {event.leaderboard.length > 0 ? <div className="mt-5 grid md:grid-cols-3 gap-3">{event.leaderboard.slice(0, 3).map((row, index) => <div key={row.id} className="border-2 border-[var(--border)] rounded-md p-3 flex items-center gap-3"><Medal className="w-5 h-5 text-[var(--secondary)] shrink-0" /><ProfileAvatar name={row.displayName} pictureUrl={row.pictureUrl} className="w-9 h-9 text-[10px]" /><div className="min-w-0"><p className="font-bold truncate">#{index + 1} · {row.displayName}</p><p className="text-sm font-mono text-[var(--text-secondary)]">{row.wpm} WPM · {row.accuracy}%</p></div></div>)}</div> : <p className="mt-5 text-sm text-[var(--text-muted)]">No eligible scores yet.</p>}
            </>;
            return isCurrent ? (
              <a key={event.id} href="/event/admin" className="nb-card block p-5 md:p-6 border-2 border-[var(--secondary)] shadow-[4px_4px_0_var(--secondary)] hover:-translate-y-0.5 transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--secondary)]" aria-label={`Open admin controls for current event: ${event.title}`}>
                {cardContent}
              </a>
            ) : (
              <article key={event.id} className="nb-card p-5 md:p-6">
                {cardContent}
              </article>
            );
          })}</div>
        )}
      </div>
    </div>
  );
}
