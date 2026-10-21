"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import SetupPhase from "@/components/SetupPhase";
import CountdownPhase from "@/components/CountdownPhase";
import TypingArea from "@/components/TypingArea";
import ResultPhase from "@/components/ResultPhase";
import { useSocket } from "@/hooks/useSocket";
import { Copy, Check, Wifi, WifiOff } from "lucide-react";

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
  const [copied, setCopied] = useState(false);
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

  useEffect(() => {
    const username = localStorage.getItem("username") || "Player";
    if (!hasJoined && roomId) {
      joinRoom(roomId, username);
      setHasJoined(true);
    }
  }, [roomId, joinRoom, hasJoined]);

  useEffect(() => {
    if (socket?.id) {
      setCurrentUserId(socket.id);
    }
  }, [socket?.id]);

  const handleConfigChange = (config: { timerDuration: number }) => {
    if (isConnected) {
      configureTest(config);
    } else {
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
      setMockParticipants((prev) => prev.map((p) => ({ ...p, isReady: false })));
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

  const handleCopyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = roomId;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const phase = roomState?.phase || "setup";
  const roomConfig = roomState?.config || mockConfig;
  const participants =
    isConnected && roomState?.participants ? roomState.participants : mockParticipants;
  const effectiveCurrentUserId = currentUserId || "mock-1";

  const currentUser = participants.find((p) => p.id === effectiveCurrentUserId);
  const isHost = currentUser?.isHost || false;

  return (
    <div className="min-h-[80vh] py-8 animate-fade-in-up">
      <div className="max-w-6xl mx-auto">
        {/* Room header */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
          {/* Room code badge */}
          <button
            onClick={handleCopyRoomCode}
            className="nb-card-flat flex items-center gap-3 px-5 py-2.5 cursor-pointer hover:shadow-[var(--shadow-sm)] transition-all duration-100 group/copy"
          >
            <span className="text-[var(--ts-xs)] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Room
            </span>
            <span className="text-[var(--ts-xl)] font-black font-mono text-[var(--secondary)] tracking-widest">
              {roomId}
            </span>
            {copied ? (
              <Check className="w-4 h-4 text-[var(--success)]" />
            ) : (
              <Copy className="w-4 h-4 text-[var(--text-muted)] group-hover/copy:text-[var(--text)]" />
            )}
          </button>

          {/* Connection pill */}
          <div
            className={`nb-badge ${
              isConnected
                ? "bg-[var(--success)] text-white"
                : "bg-[var(--surface-alt)] text-[var(--text-muted)]"
            }`}
          >
            {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {isConnected ? "Connected" : "Offline"}
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

        {phase === "countdown" && <CountdownPhase />}

        {finalRankings && finalRankings.length > 0 ? (
          <ResultPhase
            rankings={finalRankings}
            currentUserId={effectiveCurrentUserId}
            isHost={isHost}
            onPlayAgain={handlePlayAgain}
          />
        ) : phase === "test" ? (
          <div className="max-w-5xl mx-auto">
            <TypingArea
              time={time}
              isTestActive={isTestActive}
              testContent={testContent}
              onTestStart={handleTestStart}
              onTestFinish={handleTestFinish}
              onResultsSubmit={handleResultsSubmit}
              isMultiplayer={true}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
