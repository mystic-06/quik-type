"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import SetupPhase from "@/components/SetupPhase";
import CountdownPhase from "@/components/CountdownPhase";
import TypingArea from "@/components/TypingArea";
import ResultPhase from "@/components/ResultPhase";
import { useSocket } from "@/hooks/useSocket";
import { Copy, Check, Wifi, WifiOff, AlertCircle, X, UsersRound, Crown, LogOut } from "lucide-react";

export default function Room() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.roomId as string;
  const {
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
    testContent,
    finalRankings,
  } = useSocket();
  const [hasJoined, setHasJoined] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mockParticipants, setMockParticipants] = useState(() => [
    {
      id: "mock-1",
      username: "Player",
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
    // Offline preview only: the name is read here, after hydration, not while rendering
    setMockParticipants((prev) => prev.map((p) => (p.id === "mock-1" ? { ...p, username } : p)));
    if (!hasJoined && roomId) {
      joinRoom(roomId, username);
      setHasJoined(true);
    }
  }, [roomId, joinRoom, hasJoined]);

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

  function handleResultsSubmit(results: { typed: string }) {
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

  const team = isConnected ? roomState?.team ?? null : null;

  const handleLeaveTeam = () => {
    leaveRoom();
    router.push("/teams");
  };

  const phase = roomState?.phase || "setup";
  const roomConfig = roomState?.config || mockConfig;
  const participants =
    isConnected && roomState?.participants ? roomState.participants : mockParticipants;
  const effectiveCurrentUserId = (isConnected && myId) || "mock-1";

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

        {team && (
          <div className="nb-card-flat max-w-xl mx-auto mb-6 px-5 py-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <span className="flex items-center gap-2 font-black">
              <UsersRound className="w-4 h-4" /> {team.name}
            </span>
            <span className="font-mono text-[var(--ts-sm)] text-[var(--text-secondary)]">
              {participants.length}/{team.targetSize} players
            </span>
            {isHost && (
              <span className="nb-badge bg-[var(--primary)] text-[10px]">
                <Crown className="w-2.5 h-2.5" /> You are captain
              </span>
            )}
            {team.disqualified && <span className="nb-badge bg-[var(--surface-alt)] text-[10px]">Not counted on the leaderboard</span>}
            <button onClick={handleLeaveTeam} className="nb-btn nb-btn-ghost !py-1 !px-3 text-[var(--ts-xs)]">
              <LogOut className="w-3.5 h-3.5" /> Leave team
            </button>
          </div>
        )}

        {roomClosed && (
          <div role="alert" className="nb-card max-w-xl mx-auto mb-6 p-6 text-center">
            <p className="font-bold mb-3">{roomClosed}</p>
            <Link href="/teams" className="nb-btn nb-btn-primary inline-flex">
              Back to Teams
            </Link>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="nb-card-flat max-w-xl mx-auto mb-6 px-4 py-3 flex items-center gap-3 bg-[var(--surface-alt)]"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-[var(--secondary)]" />
            <span className="text-[var(--ts-sm)] font-bold flex-1">{error}</span>
            <button onClick={clearError} aria-label="Dismiss" className="cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {phase === "setup" && (
          <SetupPhase
            isHost={isHost}
            roomConfig={roomConfig}
            participants={participants}
            onConfigChange={handleConfigChange}
            onReadyToggle={handleReadyToggle}
            currentUserId={effectiveCurrentUserId}
            team={team}
            onLockRoster={lockRoster}
          />
        )}

        {phase === "countdown" && <CountdownPhase />}

        {finalRankings && finalRankings.length > 0 ? (
          <ResultPhase
            rankings={finalRankings}
            currentUserId={effectiveCurrentUserId}
            isHost={isHost}
            onPlayAgain={handlePlayAgain}
            teamResult={teamResult}
            teamStanding={teamStanding}
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
