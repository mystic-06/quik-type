"use client";
import { useEffect, useState } from "react";
import { Trophy, Medal, Loader2, WifiOff } from "lucide-react";
import { PLAYER_ID_KEY, SERVER_URL, TEAM_CODE_KEY } from "@/hooks/useSocket";

const DURATIONS = [15, 30, 60, 120] as const;
const SCOPES = [
  { value: "player", label: "Players" },
  { value: "team", label: "Teams" },
] as const;
const PERIODS = [
  { value: "all", label: "All time" },
  { value: "day", label: "Today" },
] as const;

interface Entry {
  rank: number;
  id: string;
  name: string;
  wpm: number;
  accuracy: number;
}

interface Board {
  entries: Entry[];
  total: number;
  me: { rank: number; wpm: number; accuracy: number } | null;
}

type Status = "loading" | "ready" | "error";

const rankBg = (rank: number) =>
  rank === 1 ? "bg-[var(--primary)]" : rank === 2 ? "bg-[var(--surface-alt)]" : rank === 3 ? "bg-[var(--secondary)] text-white" : "bg-white";

export default function Leaderboard() {
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>(30);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["value"]>("all");
  const [scope, setScope] = useState<(typeof SCOPES)[number]["value"]>("player");
  const [board, setBoard] = useState<Board | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [teamCode, setTeamCode] = useState<string | null>(null);

  useEffect(() => {
    try {
      setPlayerId(localStorage.getItem(PLAYER_ID_KEY));
      setTeamCode(localStorage.getItem(TEAM_CODE_KEY));
    } catch {
      setPlayerId(null);
      setTeamCode(null);
    }
  }, []);

  // Who to highlight: this browser's player, or its team
  const myId = scope === "team" ? teamCode : playerId;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ duration: String(duration), period, limit: "50", scope });
    if (myId) params.set("me", myId);

    setStatus("loading");
    fetch(`${SERVER_URL}/leaderboard?${params}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((data: Board) => {
        setBoard(data);
        setStatus("ready");
      })
      .catch((err) => {
        if (err?.name !== "AbortError") setStatus("error");
      });
    return () => controller.abort();
  }, [duration, period, scope, myId]);

  const showMeBelow = board?.me && !board.entries.some((e) => e.id === myId);

  return (
    <div className="min-h-[70vh] py-8 animate-fade-in-up">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-[var(--primary)] border-2 border-[var(--border)] rounded-lg shadow-[var(--shadow)] mb-4">
            <Trophy className="w-8 h-8" />
          </div>
          <h1 className="text-[var(--ts-2xl)] font-black">Leaderboard</h1>
          <p className="text-[var(--text-secondary)] text-[var(--ts-sm)] mt-1">
            {scope === "team"
              ? "Best team average from team rooms. A team counts only when it is full and every member finishes."
              : "Best result per player from multiplayer rooms. Scores are worked out by the server from what was typed."}
          </p>
        </div>

        <div className="flex justify-center gap-2 mb-4" role="group" aria-label="Players or teams">
          {SCOPES.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setScope(value)}
              aria-pressed={scope === value}
              className={`px-5 py-2 font-black rounded-md cursor-pointer border-2 border-[var(--border)] transition-all duration-100 ${
                scope === value ? "bg-[var(--text)] text-white shadow-[2px_2px_0_var(--border)]" : "bg-white text-[var(--text-secondary)] hover:bg-[var(--surface-alt)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-4 mb-6">
          <div className="flex gap-2" role="group" aria-label="Test length">
            {DURATIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                aria-pressed={duration === d}
                className={`px-4 py-2 font-mono font-bold rounded-md cursor-pointer border-2 border-[var(--border)] transition-all duration-100 ${
                  duration === d ? "bg-[var(--primary)] shadow-[2px_2px_0_var(--border)]" : "bg-white text-[var(--text-secondary)] hover:bg-[var(--surface-alt)]"
                }`}
              >
                {d}s
              </button>
            ))}
          </div>
          <div className="flex gap-2" role="group" aria-label="Period">
            {PERIODS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setPeriod(value)}
                aria-pressed={period === value}
                className={`px-4 py-2 font-bold rounded-md cursor-pointer border-2 border-[var(--border)] transition-all duration-100 ${
                  period === value ? "bg-[var(--secondary)] text-white shadow-[2px_2px_0_var(--border)]" : "bg-white text-[var(--text-secondary)] hover:bg-[var(--surface-alt)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="nb-card p-6">
          {status === "loading" && !board && (
            <div className="flex items-center justify-center gap-2 py-12 text-[var(--text-muted)]">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="font-bold">Loading...</span>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <WifiOff className="w-6 h-6 text-[var(--text-muted)]" />
              <p className="font-bold">The leaderboard could not be loaded.</p>
              <p className="text-[var(--ts-sm)] text-[var(--text-secondary)]">
                The game server may be waking up. Try again in a moment.
              </p>
            </div>
          )}

          {status === "ready" && board && board.entries.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Medal className="w-6 h-6 text-[var(--text-muted)]" />
              <p className="font-bold">No results yet for {duration}s{period === "day" ? " today" : ""}.</p>
              <p className="text-[var(--ts-sm)] text-[var(--text-secondary)]">
                {scope === "team" ? "Finish a round with a full team to claim the first place." : "Finish a multiplayer round to claim the first place."}
              </p>
            </div>
          )}

          {board && board.entries.length > 0 && status !== "error" && (
            <ol className="space-y-2" aria-busy={status === "loading"}>
              {board.entries.map((entry) => {
                const isMe = entry.id === myId;
                return (
                  <li
                    key={entry.id}
                    className={`flex items-center justify-between p-3 rounded-md border-2 border-[var(--border)] ${isMe ? "bg-[var(--surface-alt)]" : "bg-white"}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-9 h-9 shrink-0 rounded-md flex items-center justify-center font-black border-2 border-[var(--border)] ${rankBg(entry.rank)}`}>
                        {entry.rank}
                      </div>
                      <p className="font-bold truncate">
                        {entry.name}
                        {isMe && <span className="nb-badge ml-2 bg-[var(--secondary)] text-white text-[10px]">{scope === "team" ? "Your team" : "You"}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-6 text-right shrink-0">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-muted)]">WPM</p>
                        <p className="text-[var(--ts-lg)] font-black font-mono text-[var(--secondary)]">{entry.wpm}</p>
                      </div>
                      <div className="w-14">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-muted)]">Acc</p>
                        <p className="font-bold font-mono">{entry.accuracy}%</p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {showMeBelow && board?.me && (
            <p className="mt-5 text-center text-[var(--ts-sm)] font-bold text-[var(--text-secondary)]">
              {scope === "team" ? "Your team's best" : "Your best"}: #{board.me.rank} with {board.me.wpm} WPM at {board.me.accuracy}% accuracy
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
