"use client";
import { generate } from "random-words";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

export const SERVER_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";

const SECRET_KEY = "qt_secret";
/** Where the page remembers its own public player id, so the leaderboard can highlight it. */
export const PLAYER_ID_KEY = "qt_player_id";
/** The team this browser is in, so the leaderboard can highlight it. */
export const TEAM_CODE_KEY = "qt_team_code";

/**
 * A secret this browser keeps. The server derives the player's identity from it, so a refresh, a dropped connection or a reconnect gets
 * the same seat back. It is never shown to other players.
 */
export function browserSecret(): string {
  const make = () => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  };
  try {
    let secret = localStorage.getItem(SECRET_KEY);
    if (!secret || secret.length < 16) {
      secret = make();
      localStorage.setItem(SECRET_KEY, secret);
    }
    return secret;
  } catch {
    return make();
  }
}

export interface Participant {
  id: string;
  username: string;
  isReady: boolean;
  isHost: boolean;
  connected?: boolean;
  excused?: boolean;
}

export interface Team {
  name: string;
  code: string;
  targetSize: number;
  full: boolean;
  fromRoster: boolean;
  disqualified: boolean;
  captainId: string | null;
}

export interface TeamResult {
  name: string;
  code: string;
  averageWpm: number;
  averageAccuracy: number;
  members: number;
  /** Whether it went on the team leaderboard (a full team, every member verified). */
  counted: boolean;
}

export interface TeamStanding {
  rank: number;
  bestWpm: number;
  duration: number;
}

export interface RoomState {
  id: string;
  kind?: "open" | "team";
  team?: Team | null;
  hostId: string | null;
  phase: "setup" | "countdown" | "test" | "results";
  config: {
    timerDuration: number;
  };
  participants: Participant[];
}

interface PlayerResult {
  id: string;
  username: string;
  wpm: number;
  rawWpm: number;
  accuracy: number;
  charactersTyped: number;
  completionPercentage: number;
  rank: number;
}

interface UseSocketReturn {
  socket: Socket | null;
  isConnected: boolean;
  /** This player's id as other players and the rankings see it. Empty until the server has said. */
  myId: string;
  /** The last thing the server refused or reported, shown briefly. */
  error: string | null;
  clearError: () => void;
  roomState: RoomState | null;
  joinRoom: (roomId: string, username: string) => void;
  configureTest: (config: { timerDuration: number }) => void;
  toggleReady: () => void;
  restartRoom: () => void;
  leaveRoom: () => void;
  /** Team captain: fix the team at the players it has now. */
  lockRoster: () => void;
  /** Set when the room is gone for this player (removed or dissolved by an organizer). */
  roomClosed: string | null;
  teamResult: TeamResult | null;
  teamStanding: TeamStanding | null;
  /** Sends what was typed. The server works out the score; nothing else is trusted. */
  submitResults: (results: { typed: string }) => void;

  time: number;
  isTestActive: boolean;
  setTime: React.Dispatch<React.SetStateAction<number>>;
  setTestStatus: React.Dispatch<React.SetStateAction<boolean>>;
  testContent: string;
  finalRankings: PlayerResult[] | null;
}

export function useSocket(): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  // The room this page wants to be in. Used to take the seat back after any reconnect.
  const wantedRoomRef = useRef<{ roomId: string; username: string } | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [myId, setMyId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [time, setTime] = useState(15);
  const [isTestActive, setTestStatus] = useState(false);
  const [testContent, setTestContent] = useState<string>("");
  const [finalRankings, setFinalRankings] = useState<PlayerResult[] | null>(null);
  const [teamResult, setTeamResult] = useState<TeamResult | null>(null);
  const [teamStanding, setTeamStanding] = useState<TeamStanding | null>(null);
  const [roomClosed, setRoomClosed] = useState<string | null>(null);

  // Generate fallback content for offline mode
  const fallbackContent = useMemo(() => (generate(200) as string[]).join(" "), []);

  const showError = useCallback((message: string) => {
    setError(message);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(null), 5000);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    // Initialize socket connection
    socketRef.current = io(SERVER_URL, {
      autoConnect: false,
      // The event sign-in is a cookie, so cookies are sent; the player's own identity is the browser secret
      withCredentials: true,
      auth: { secret: browserSecret() },
    });

    const socket = socketRef.current;

    const rememberId = (id: string) => {
      setMyId(id);
      try {
        localStorage.setItem(PLAYER_ID_KEY, id);
      } catch {
        // storage unavailable: the leaderboard just will not highlight this player
      }
    };

    // Connection event handlers
    socket.on("connect", () => {
      setIsConnected(true);
      // First connection, a dropped network, or a server restart: take the seat (back)
      const wanted = wantedRoomRef.current;
      if (wanted) socket.emit("join-room", wanted.roomId, wanted.username);
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("connect_error", (err) => {
      console.error("Connection error:", err);
      setIsConnected(false);
    });

    socket.on("identity", ({ id }: { id: string }) => {
      rememberId(id);
    });

    // Room event handlers
    socket.on("room-joined", (state: RoomState & { you?: string }) => {
      if (state.you) rememberId(state.you);
      setRoomState(state);
      try {
        if (state.team) localStorage.setItem(TEAM_CODE_KEY, state.team.code);
      } catch {
        // storage unavailable
      }
    });

    socket.on("participant-joined", (participant: Participant) => {
      setRoomState((prev) => {
        if (!prev) return prev;
        const others = prev.participants.filter((p) => p.id !== participant.id);
        return { ...prev, participants: [...others, participant] };
      });
    });

    socket.on("participant-left", (participantId: string) => {
      setRoomState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          participants: prev.participants.filter((p) => p.id !== participantId),
        };
      });
    });

    socket.on("participant-status", (participantId: string, connected: boolean) => {
      setRoomState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          participants: prev.participants.map((p) => (p.id === participantId ? { ...p, connected } : p)),
        };
      });
    });

    socket.on("host-changed", (hostId: string) => {
      setRoomState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          hostId,
          participants: prev.participants.map((p) => ({ ...p, isHost: p.id === hostId })),
        };
      });
    });

    socket.on("participant-excused", (participantId: string, excused: boolean) => {
      setRoomState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          participants: prev.participants.map((p) => (p.id === participantId ? { ...p, excused, isReady: excused ? false : p.isReady } : p)),
        };
      });
    });

    socket.on("team-updated", (team: Team) => {
      setRoomState((prev) => (prev ? { ...prev, team } : prev));
    });

    socket.on("team-result", (result: TeamResult) => {
      setTeamResult(result);
      setTeamStanding(null);
    });

    socket.on("team-standing", (standing: TeamStanding) => {
      setTeamStanding(standing);
    });

    // An organizer removed this player, or dissolved the team: the room is no longer theirs
    const closed = (message: string) => {
      wantedRoomRef.current = null;
      setRoomClosed(message);
    };
    socket.on("removed-from-team", (message: string) => closed(message));
    socket.on("team-dissolved", (message: string) => closed(message));

    socket.on("config-updated", (config: { timerDuration: number }) => {
      setRoomState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          config,
        };
      });
    });

    socket.on(
      "ready-state-changed",
      (participantId: string, isReady: boolean) => {
        setRoomState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            participants: prev.participants.map((p) =>
              p.id === participantId ? { ...p, isReady } : p
            ),
          };
        });
      }
    );

    socket.on("countdown-start", () => {
      setRoomState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          phase: "countdown",
        };
      });
    });

    socket.on("test-start", (testText: string, duration: number) => {
      setTestContent(testText);
      setTime(duration);
      setTestStatus(true);
      setRoomState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          phase: "test",
        };
      });
    });

    // Note: test-end is no longer used - clients handle their own timers
    // and submit what they typed when done. The server scores it and moves to the
    // results phase when all results are in, or when the deadline passes.

    socket.on("room-state-updated", (state: RoomState) => {
      setRoomState(state);
    });

    socket.on("final-rankings", (rankings: PlayerResult[]) => {
      setFinalRankings(rankings);
    });

    socket.on("room-restarted", (state: RoomState) => {
      setRoomState(state);
      setFinalRankings(null);
      setTeamResult(null);
      setTeamStanding(null);
      setTestStatus(false);
    });

    socket.on("session-replaced", () => {
      // The same browser joined this room in another tab, which now holds the seat
      wantedRoomRef.current = null;
      showError("This room was opened in another tab.");
    });

    socket.on("error", (message: string) => {
      console.error("Socket error:", message);
      showError(message);
    });

    // Cleanup on unmount
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      socket.disconnect();
    };
  }, [showError]);

  const joinRoom = useCallback((roomId: string, username: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    wantedRoomRef.current = { roomId, username };
    if (socket.connected) {
      socket.emit("join-room", roomId, username);
    } else {
      // The "connect" handler joins once the connection is up
      socket.connect();
    }
  }, []);

  const configureTest = (config: { timerDuration: number }) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit("configure-test", config);
    }
  };

  const toggleReady = () => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit("ready-toggle");
    }
  };

  const submitResults = (results: { typed: string }) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit("submit-results", { typed: results.typed });
      setTestStatus(false);
    }
  };

  const restartRoom = () => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit("restart-room");
    }
  };

  const lockRoster = () => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit("lock-roster");
    }
  };

  const leaveRoom = () => {
    wantedRoomRef.current = null;
    if (socketRef.current && isConnected) {
      socketRef.current.emit("leave-room");
      socketRef.current.disconnect();
    }
  };

  return {
    socket: socketRef.current,
    isConnected,
    myId,
    error,
    clearError,
    roomState,
    joinRoom,
    configureTest,
    toggleReady,
    restartRoom,
    submitResults,
    leaveRoom,
    lockRoster,
    roomClosed,
    teamResult,
    teamStanding,
    time,
    isTestActive,
    setTime,
    setTestStatus,
    testContent: testContent || fallbackContent,
    finalRankings
  };
}
