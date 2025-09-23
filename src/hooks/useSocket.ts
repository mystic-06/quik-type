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

interface UseSocketReturn {
  socket: Socket | null;
  isConnected: boolean;
  roomState: RoomState | null;
  joinRoom: (roomId: string, username: string) => void;
  configureTest: (config: { timerDuration: number }) => void;
  toggleReady: () => void;
  leaveRoom: () => void;

  time: number;
  isTestActive: boolean;
  setTime: React.Dispatch<React.SetStateAction<number>>;
  setTestStatus: React.Dispatch<React.SetStateAction<boolean>>;
  testContent: string;
}

export function useSocket(): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [time, setTime] = useState(15);
  const [isTestActive, setTestStatus] = useState(false);
  const [testContent, setTestContent] = useState<string>("");

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
      console.log("Connected to server", socket.id);
      setIsConnected(true);
    });

    socket.on("disconnect", () => {
      console.log("Disconnected from server");
      setIsConnected(false);
    });

    socket.on("connect_error", (error) => {
      console.error("Connection error:", error);
      setIsConnected(false);
    });

    // Room event handlers
    socket.on("room-joined", (roomState: RoomState) => {
      console.log("Room joined event received:", roomState);
      setRoomState(roomState);
      console.log("Room state updated");
    });

    socket.on("participant-joined", (participant: Participant) => {
      console.log("Participant joined:", participant);
      setRoomState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          participants: [...prev.participants, participant],
        };
      });
    });

    socket.on("participant-left", (participantId: string) => {
      console.log("Participant left:", participantId);
      setRoomState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          participants: prev.participants.filter((p) => p.id !== participantId),
        };
      });
    });

    socket.on("config-updated", (config: { timerDuration: number }) => {
      console.log("Config updated:", config);
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
        console.log("Ready state changed:", participantId, isReady);
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
      console.log("Countdown started:", countdown);
      setRoomState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          phase: "countdown",
        };
      });
    });

    socket.on("countdown-update", (countdown: number) => {
      console.log("Countdown update:", countdown);
    });

    socket.on("test-start", (testText: string, duration: number) => {
      console.log("Test started:", testText, duration);
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

    socket.on("test-end", () => {
      console.log("Test ended");
      setTestStatus(false);
      setRoomState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          phase: "results",
        };
      });
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
    console.log('joinRoom called', { roomId, username, socketExists: !!socketRef.current });
    if (socketRef.current) {
      console.log('Connecting socket...');
      socketRef.current.connect();
      console.log('Emitting join-room event...');
      socketRef.current.emit("join-room", roomId, username);
    }
  };

  const configureTest = (config: { timerDuration: number }) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit("configure-test", config);
    }
  };

  const toggleReady = () => {
    console.log('toggleReady called', { socketExists: !!socketRef.current, isConnected });
    if (socketRef.current && isConnected) {
      console.log('Emitting ready-toggle event');
      socketRef.current.emit("ready-toggle");
    } else {
      console.log('Cannot emit ready-toggle - socket not connected');
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
    leaveRoom,
    time,
    isTestActive,
    setTime,
    setTestStatus,
    testContent: testContent || fallbackContent
  };
}
