"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UsersRound, Plus, ArrowRight, Hash, Mail, User, LogOut, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { checkIn, createTeam, getTeams, joinTeam, leaveTeam, TeamsApiError, type TeamsOverview } from "@/lib/teamsApi";

const SIZES = [1, 2, 3, 4];

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "Waiting for members",
  LOBBY: "Gathering",
  AWAITING_READY: "Full, getting ready",
  COUNTDOWN: "Starting",
  IN_TEST: "Typing now",
  FINISHED: "Finished a round",
};

export default function Teams() {
  const router = useRouter();
  const [overview, setOverview] = useState<TeamsOverview | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [username, setUsername] = useState("");
  const [teamName, setTeamName] = useState("");
  const [size, setSize] = useState(2);
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setUsername(localStorage.getItem("username") || "");
    } catch {
      // storage unavailable
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setOverview(await getTeams());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  // Load the list, and keep it current while a roster is being checked into
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const run = async (action: () => Promise<{ code: string } | unknown>, enter = true) => {
    setBusy(true);
    setError(null);
    try {
      const result = (await action()) as { code?: string };
      if (username.trim()) localStorage.setItem("username", username.trim());
      if (enter && result?.code) router.push(`/room/${result.code}`);
      else await refresh();
    } catch (err) {
      setError(err instanceof TeamsApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const needName = () => {
    if (!username.trim()) {
      setError("Enter a username first.");
      return false;
    }
    return true;
  };

  const rosterActive = overview?.rosterActive ?? false;
  const myTeam = overview?.myTeam ?? null;

  return (
    <div className="min-h-[75vh] py-8 animate-fade-in-up">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-[var(--secondary)] border-2 border-[var(--border)] rounded-lg shadow-[var(--shadow)] mb-4">
            <UsersRound className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-[var(--ts-2xl)] font-black">Teams</h1>
          <p className="text-[var(--text-secondary)] text-[var(--ts-sm)] mt-1 max-w-md mx-auto">
            A team is up to four players with a captain. Everyone types the same text and the team&apos;s score is the average of its members.
          </p>
        </div>

        {error && (
          <div role="alert" className="nb-card-flat max-w-xl mx-auto mb-6 px-4 py-3 flex items-center gap-3 bg-[var(--surface-alt)]">
            <AlertCircle className="w-4 h-4 shrink-0 text-[var(--secondary)]" />
            <span className="text-[var(--ts-sm)] font-bold flex-1">{error}</span>
          </div>
        )}

        {loadFailed && !overview && (
          <p className="text-center text-[var(--ts-sm)] text-[var(--text-secondary)] mb-6">
            The game server could not be reached. It may be waking up; this page will keep trying.
          </p>
        )}

        {myTeam && (
          <div className="nb-card p-6 mb-6 flex flex-col sm:flex-row items-center gap-4">
            <div className="flex-1 text-center sm:text-left">
              <p className="text-[var(--ts-xs)] font-bold uppercase tracking-wider text-[var(--text-muted)]">Your team</p>
              <p className="text-[var(--ts-xl)] font-black">{myTeam.name}</p>
              <p className="font-mono text-[var(--text-secondary)]">
                Code <span className="font-black text-[var(--secondary)] tracking-widest">{myTeam.code}</span>
              </p>
            </div>
            <button onClick={() => router.push(`/room/${myTeam.code}`)} className="nb-btn nb-btn-primary">
              Open room <ArrowRight className="w-4 h-4" />
            </button>
            <button onClick={() => run(leaveTeam, false)} disabled={busy} className="nb-btn nb-btn-ghost">
              <LogOut className="w-4 h-4" /> Leave
            </button>
          </div>
        )}

        {!myTeam && (
          <div className="nb-card p-6 mb-6 max-w-xl mx-auto">
            <label className="flex items-center gap-2 text-[var(--ts-xs)] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2" htmlFor="team-username">
              <User className="w-3.5 h-3.5" /> Your name
            </label>
            <input
              id="team-username"
              className="nb-input w-full"
              placeholder="How teammates will see you"
              maxLength={20}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
        )}

        {!myTeam && rosterActive && (
          <>
            <div className="nb-card p-6 mb-6 max-w-xl mx-auto">
              <div className="flex items-center gap-2 mb-3">
                <Mail className="w-4 h-4" />
                <h2 className="text-[var(--ts-lg)] font-black">Check in</h2>
              </div>
              <p className="text-[var(--ts-sm)] text-[var(--text-secondary)] mb-4">
                This event has a team list. Enter the email you registered with and you will be placed in your team.
              </p>
              <input
                className="nb-input w-full mb-3"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && email.trim() && needName() && run(() => checkIn(email.trim(), username.trim() || undefined))}
              />
              <button
                onClick={() => needName() && run(() => checkIn(email.trim(), username.trim() || undefined))}
                disabled={busy || !email.trim()}
                className="nb-btn nb-btn-primary w-full"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Check in
              </button>
            </div>

            <div className="nb-card p-6">
              <h2 className="text-[var(--ts-xs)] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-4 text-center">
                Teams in this event
              </h2>
              <ul className="space-y-2">
                {overview!.teams.map((team) => (
                  <li key={team.code} className="flex items-center justify-between gap-3 p-3 rounded-md border-2 border-[var(--border)] bg-white">
                    <div className="min-w-0">
                      <p className="font-bold truncate">{team.name}</p>
                      <p className="text-[var(--ts-xs)] text-[var(--text-muted)] font-mono">{team.code}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[var(--ts-xs)] font-bold text-[var(--text-secondary)]">{STATUS_LABEL[team.status] ?? team.status}</p>
                      <p className="font-mono text-[var(--ts-sm)] flex items-center justify-end gap-1">
                        {team.checkedIn === team.targetSize && <CheckCircle2 className="w-3.5 h-3.5 text-[var(--success)]" />}
                        {team.checkedIn}/{team.targetSize} checked in
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        {!myTeam && overview && !rosterActive && (
          <div className="grid md:grid-cols-2 gap-6">
            <div className="nb-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <Plus className="w-4 h-4" />
                <h2 className="text-[var(--ts-lg)] font-black">Create a team</h2>
              </div>
              <input className="nb-input w-full mb-3" placeholder="Team name" maxLength={30} value={teamName} onChange={(e) => setTeamName(e.target.value)} />
              <p className="text-[var(--ts-xs)] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">Players</p>
              <div className="flex gap-2 mb-4" role="group" aria-label="Team size">
                {SIZES.map((n) => (
                  <button
                    key={n}
                    onClick={() => setSize(n)}
                    aria-pressed={size === n}
                    className={`w-12 py-2 font-mono font-bold rounded-md cursor-pointer border-2 border-[var(--border)] ${
                      size === n ? "bg-[var(--primary)] shadow-[2px_2px_0_var(--border)]" : "bg-white hover:bg-[var(--surface-alt)]"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <button onClick={() => needName() && run(() => createTeam(teamName.trim(), size, username.trim()))} disabled={busy || !teamName.trim()} className="nb-btn nb-btn-primary w-full">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Create
              </button>
            </div>

            <div className="nb-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <Hash className="w-4 h-4" />
                <h2 className="text-[var(--ts-lg)] font-black">Join with a code</h2>
              </div>
              <input
                className="nb-input w-full mb-4 font-mono uppercase tracking-widest"
                placeholder="AB-12"
                maxLength={10}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && code.trim() && needName() && run(() => joinTeam(code.trim(), username.trim()))}
              />
              <button onClick={() => needName() && run(() => joinTeam(code.trim(), username.trim()))} disabled={busy || !code.trim()} className="nb-btn nb-btn-secondary w-full">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Join team
              </button>
              <p className="text-[var(--ts-xs)] text-[var(--text-muted)] mt-3">Ask your captain for the code. You can only be in one team.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
