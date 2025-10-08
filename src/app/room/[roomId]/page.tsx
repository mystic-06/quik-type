"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import SetupPhase from "@/components/SetupPhase";
import CountdownPhase from "@/components/CountdownPhase";
import TypingArea from "@/components/TypingArea";
import ResultPhase from "@/components/ResultPhase";
import { useSocket } from "@/hooks/useSocket";

export default function Room() {
  const params = useParams();
  const roomId = params.roomId as string;
  const {
    socket,
    isConnected,
    roomState,
    joinRoom,
    configureTest,
    toggleReady,
    restartRoom,
    submitResults,
    time,
    isTestActive,
    setTime,
    setTestStatus,
    testContent,
    finalRankings,
  } = useSocket();
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [hasJoined, setHasJoined] = useState(false);
  const [mockParticipants, setMockParticipants] = useState(() => [
    {
      id: "mock-1",
      username:
        typeof window !== "undefined"
          ? localStorage.getItem("username") || "Player"
          : "Player",
      isReady: false,
      isHost: true,
    },
    {
      id: "mock-2",
      username: "TestPlayer2",
      isReady: false,
      isHost: false,
    },
  ]);
  const [mockConfig, setMockConfig] = useState({ timerDuration: 15 });

  // Join room on component mount
  useEffect(() => {
    const username = localStorage.getItem("username") || "Player";
    if (!hasJoined && roomId) {
      joinRoom(roomId, username);
      setHasJoined(true);
    }
  }, [roomId, joinRoom, hasJoined]);

  // Set current user ID when socket connects
  useEffect(() => {
    if (socket?.id) {
      setCurrentUserId(socket.id);
    }
  }, [socket?.id]);

  const handleConfigChange = (config: { timerDuration: number }) => {
    if (isConnected) {
      configureTest(config);
    } else {
      // Update mock config for offline mode
      setMockConfig(config);
    }
  };

  function handleTestStart() {
    setTestStatus(true);
  }

  function handleTestFinish() {
    setTestStatus(false);
  }

  function handleResultsSubmit(results: {
    wpm: number;
    rawWpm: number;
    accuracy: number;
    charactersTyped: number;
    completionPercentage: number;
  }) {
    submitResults(results);
  }

  function handlePlayAgain() {
    if (isConnected && isHost) {
      restartRoom();
    } else {
      setMockParticipants(prev => prev.map(p => ({ ...p, isReady: false })));
    }
  }

  const handleReadyToggle = () => {
    if (isConnected && roomState) {
      toggleReady();
    } else {
      setMockParticipants((prev) => {
        const updated = prev.map((p) =>
          p.id === effectiveCurrentUserId ? { ...p, isReady: !p.isReady } : p
        );
        return updated;
      });
    }
  };

  // Use socket room state or fallback to mock data for development
  const phase = roomState?.phase || "setup";
  const roomConfig = roomState?.config || mockConfig;
  const participants =
    isConnected && roomState?.participants
      ? roomState.participants
      : mockParticipants;
  const effectiveCurrentUserId = currentUserId || "mock-1";

  const currentUser = participants.find((p) => p.id === effectiveCurrentUserId);
  const isHost = currentUser?.isHost || false;



  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold text-center text-primary mb-4">
          Room: <span className="text-accent-primary">{roomId}</span>
        </h1>

        {/* Connection Status */}
        <div className="text-center mb-6">
          <div
            className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm ${isConnected
              ? "bg-surface bg-opacity-20 text-accent-secondary"
              : "bg-text-secondary bg-opacity-20 text-secondary"
              }`}
          >
            <div
              className={`w-2 h-2 rounded-full ${isConnected ? "bg-accent-secondary" : "bg-text-secondary"
                }`}
            />
            {isConnected ? "Connected" : "Offline Mode"}
          </div>
        </div>

        {phase === "setup" && (
          <SetupPhase
            isHost={isHost}
            roomConfig={roomConfig}
            participants={participants}
            onConfigChange={handleConfigChange}
            onReadyToggle={handleReadyToggle}
            currentUserId={effectiveCurrentUserId}
          />
        )}

        {phase === "countdown" && (
          <div className="text-center">
            <div className="text-6xl font-bold text-accent-primary">
              <CountdownPhase />
            </div>
          </div>
        )}

        {/* Show results if we have rankings, regardless of phase */}
        {finalRankings && finalRankings.length > 0 ? (
          <ResultPhase
            rankings={finalRankings}
            currentUserId={effectiveCurrentUserId}
            isHost={isHost}
            onPlayAgain={handlePlayAgain}
          />
        ) : phase === "test" ? (
          <TypingArea
            time={time}
            isTestActive={isTestActive}
            testContent={testContent}
            onTestStart={handleTestStart}
            onTestFinish={handleTestFinish}
            onResultsSubmit={handleResultsSubmit}
            isMultiplayer={true}
          />
        ) : null}
      </div>
    </div>
  );
}
