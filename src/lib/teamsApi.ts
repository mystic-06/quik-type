import { SERVER_URL, browserSecret } from "@/hooks/useSocket";

export interface RosterTeam {
  name: string;
  code: string;
  targetSize: number;
  checkedIn: number;
  joined: number;
  full: boolean;
  status: "NOT_STARTED" | "LOBBY" | "AWAITING_READY" | "COUNTDOWN" | "IN_TEST" | "FINISHED";
}

export interface TeamsOverview {
  rosterActive: boolean;
  teams: RosterTeam[];
  myTeam: { code: string; name: string; targetSize: number } | null;
}

export interface TeamSummary {
  code: string;
  name: string;
  targetSize: number;
}

/** A refusal from the server, with the message to show the player. */
export class TeamsApiError extends Error {}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}${path}`, {
      method,
      headers: {
        "x-player-secret": browserSecret(),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new TeamsApiError("Could not reach the game server. It may be waking up; try again in a moment.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new TeamsApiError(data?.error || "Something went wrong.");
  return data as T;
}

export const getTeams = () => call<TeamsOverview>("GET", "/teams");
export const createTeam = (name: string, size: number, username: string) => call<TeamSummary>("POST", "/teams/create", { name, size, username });
export const joinTeam = (code: string, username: string) => call<TeamSummary>("POST", "/teams/join", { code, username });
export const checkIn = (email: string, username?: string) => call<TeamSummary>("POST", "/teams/checkin", { email, username });
export const leaveTeam = () => call<{ left: string }>("POST", "/teams/leave");
