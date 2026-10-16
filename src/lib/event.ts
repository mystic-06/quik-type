export const EVENT_API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";
export const MAX_EVENT_ATTEMPTS = 3;

export interface EventLeaderboardEntry {
  id: string;
  displayName: string;
  pictureUrl?: string | null;
  wpm: number;
  accuracy: number;
  attemptId: string;
  attempts: number;
  rank: number;
}

export interface EventState {
  id: string;
  title: string;
  durationSeconds: number;
  status: "lobby" | "open" | "closed";
  opensAt: number | null;
  closesAt: number | null;
  minAccuracy: number;
  participantCount: number;
  attemptsCompleted: number;
  activeAttempts: number;
  leaderboard: EventLeaderboardEntry[];
}

export async function eventFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${EVENT_API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message || `Request failed (${response.status})`);
  return payload as T;
}

export function formatRemaining(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
