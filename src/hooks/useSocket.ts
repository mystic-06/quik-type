"use client";
import { generate } from "random-words";
import { use, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

interface Participant {
  id: string;
  username: string;
  isReady: boolean;
  isHost: boolean;
}

interface RoomState {
  id: string;
  hostId: string;
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
  roomState: RoomState | null;
  joinRoom: (roomId: string, username: string) => void;
  configureTest: (config: { timerDuration: number }) => void;
  toggleReady: () => void;
  restartRoom: () => void;
  leaveRoom: () => void;
  submitResults: (results: {
    wpm: number;
    rawWpm: number;
    accuracy: number;
    charactersTyped: number;
    completionPercentage: number;
  }) => void;

  time: number;
  isTestActive: boolean;
  setTime: React.Dispatch<React.SetStateAction<number>>;
  setTestStatus: React.Dispatch<React.SetStateAction<boolean>>;
  testContent: string;
  finalRankings: PlayerResult[] | null;
}

export function useSocket(): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [time, setTime] = useState(15);
  const [isTestActive, setTestStatus] = useState(false);
  const [testContent, setTestContent] = useState<string>("");
  const [finalRankings, setFinalRankings] = useState<PlayerResult[] | null>(null);

  // Generate fallback content for offline mode
  const fallbackContent = useMemo(() => (generate(200) as string[]).join(" "), []);


  useEffect(() => {
    // Initialize socket connection
    socketRef.current = io(
      process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001",
      {
        autoConnect: false,
      }
    );

    const socket = socketRef.current;

    // Connection event handlers
    socket.on("connect", () => {
      setIsConnected(true);
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("connect_error", (error) => {
      console.error("Connection error:", error);
      setIsConnected(false);
    });

    // Room event handlers
    socket.on("room-joined", (roomState: RoomState) => {
      setRoomState(roomState);
    });

    socket.on("participant-joined", (participant: Participant) => {
      setRoomState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          participants: [...prev.participants, participant],
        };
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

    socket.on("countdown-start", (countdown: number) => {
      setRoomState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          phase: "countdown",
        };
      });
    });

    socket.on("countdown-update", (countdown: number) => {
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
    // and submit results when complete. The server transitions to results
    // phase when all results are received.

    socket.on("room-state-updated", (roomState: RoomState) => {
      setRoomState(roomState);
    });

    socket.on("final-rankings", (rankings: PlayerResult[]) => {
      setFinalRankings(rankings);
    });

    socket.on("room-restarted", (roomState: RoomState) => {
      setRoomState(roomState);
      setFinalRankings(null);
      setTestStatus(false);
    });

    socket.on("error", (message: string) => {
      console.error("Socket error:", message);
      // Handle error display to user
    });

    // Cleanup on unmount
    return () => {
      socket.disconnect();
    };
  }, []);

  const joinRoom = (roomId: string, username: string) => {
    if (socketRef.current) {
      socketRef.current.connect();
      socketRef.current.emit("join-room", roomId, username);
    }
  };

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

  const submitResults = (results: {
    wpm: number;
    rawWpm: number;
    accuracy: number;
    charactersTyped: number;
    completionPercentage: number;
  }) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit("submit-results", results);
      setTestStatus(false);
    }
  };

  const restartRoom = () => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit("restart-room");
    }
  };

  const leaveRoom = () => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit("leave-room");
      socketRef.current.disconnect();
    }
  };

  return {
    socket: socketRef.current,
    isConnected,
    roomState,
    joinRoom,
    configureTest,
    toggleReady,
    restartRoom,
    submitResults,
    leaveRoom,
    time,
    isTestActive,
    setTime,
    setTestStatus,
    testContent: testContent || fallbackContent,
    finalRankings
  };
}
