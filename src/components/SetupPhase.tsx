"use client";

import { Check, Crown, Clock, User, Lock } from "lucide-react";
import type { Participant, Team } from "@/hooks/useSocket";

interface SetupPhaseProps {
  isHost: boolean;
  roomConfig: {
    timerDuration: number;
  };
  participants: Participant[];
  onConfigChange: (config: { timerDuration: number }) => void;
  onReadyToggle: () => void;
  currentUserId: string;
  /** Set in a team room: the team's size and rules replace the open-room ones. */
  team?: Team | null;
  /** The captain fixes the team at the players it has now. */
  onLockRoster?: () => void;
}

const TIMER_OPTIONS = [15, 30, 60, 120];

export default function SetupPhase({
  isHost,
  roomConfig,
  participants,
  onConfigChange,
  onReadyToggle,
  currentUserId,
  team = null,
  onLockRoster,
}: SetupPhaseProps) {
  const currentUser = participants.find((p) => p.id === currentUserId);
  const isCurrentUserReady = currentUser?.isReady || false;
  const playing = participants.filter((p) => !p.excused);
  const readyCount = playing.filter((p) => p.isReady).length;
  const missing = team ? Math.max(team.targetSize - participants.length, 0) : 0;
  const allReady = team ? missing === 0 && playing.length > 0 && readyCount === playing.length : readyCount === playing.length && participants.length > 1;
  const leaderLabel = team ? "Captain" : "Host";

  const handleTimerChange = (duration: number) => {
    if (isHost) {
      onConfigChange({ timerDuration: duration });
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto py-6 animate-fade-in-up">
      {/* Config + Participants grid */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        {/* Timer */}
        <div className="nb-card p-6">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-8 h-8 flex items-center justify-center bg-[var(--primary)] border-2 border-[var(--border)] rounded-md">
              <Clock className="w-4 h-4" />
            </div>
            <h2 className="text-[var(--ts-lg)] font-black">Timer</h2>
            {!isHost && (
              <span className="nb-badge ml-auto bg-[var(--surface-alt)]">
                {team ? "Captain only" : "Host only"}
              </span>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            {TIMER_OPTIONS.map((duration) => (
              <button
                key={duration}
                onClick={() => handleTimerChange(duration)}
                disabled={!isHost}
                className={`px-5 py-2.5 font-mono text-[var(--ts-base)] font-bold rounded-md transition-all duration-100 cursor-pointer border-2 border-[var(--border)] ${
                  roomConfig.timerDuration === duration
                    ? "bg-[var(--primary)] shadow-[2px_2px_0_var(--border)]"
                    : isHost
                    ? "bg-white text-[var(--text-secondary)] hover:bg-[var(--surface-alt)]"
                    : "bg-[var(--surface-alt)] text-[var(--text-muted)] cursor-not-allowed"
                }`}
              >
                {duration}s
              </button>
            ))}
          </div>
        </div>

        {/* Participants */}
        <div className="nb-card p-6">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-8 h-8 flex items-center justify-center bg-[var(--secondary)] border-2 border-[var(--border)] rounded-md text-white">
              <User className="w-4 h-4" />
            </div>
            <h2 className="text-[var(--ts-lg)] font-black">Players</h2>
            <span className="nb-badge ml-auto bg-[var(--surface-alt)] font-mono">
              {participants.length}/{team ? team.targetSize : 8}
            </span>
          </div>

          <div className="space-y-2 stagger-children">
            {participants.map((participant) => {
              const isMe = participant.id === currentUserId;
              return (
                <div
                  key={participant.id}
                  className={`flex items-center justify-between p-3 rounded-md border-2 transition-all duration-100 ${
                    isMe
                      ? "border-[var(--secondary)] bg-[var(--secondary)]/5"
                      : "border-[var(--border)] bg-white"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-md flex items-center justify-center text-[var(--ts-xs)] font-black border-2 border-[var(--border)] ${
                        isMe ? "bg-[var(--secondary)] text-white" : "bg-[var(--surface-alt)]"
                      }`}
                    >
                      {participant.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--ts-sm)] font-bold">
                        {participant.username}
                      </span>
                      {participant.isHost && (
                        <span className="nb-badge bg-[var(--primary)] text-[10px]">
                          <Crown className="w-2.5 h-2.5" />
                          {leaderLabel}
                        </span>
                      )}
                      {isMe && (
                        <span className="text-[var(--ts-xs)] text-[var(--text-muted)] font-medium">(you)</span>
                      )}
                      {participant.connected === false && (
                        <span className="text-[var(--ts-xs)] text-[var(--text-muted)] font-medium">offline</span>
                      )}
                    </div>
                  </div>

                  {/* Ready indicator */}
                  {participant.excused ? (
                    <span className="nb-badge bg-[var(--surface-alt)] text-[10px]">Excused</span>
                  ) : (
                  <div
                    className={`flex items-center gap-1.5 text-[var(--ts-xs)] font-bold ${
                      participant.isReady ? "text-[var(--success)]" : "text-[var(--text-muted)]"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-md flex items-center justify-center border-2 border-[var(--border)] transition-all duration-100 ${
                        participant.isReady ? "bg-[var(--success)] text-white" : "bg-white"
                      }`}
                    >
                      {participant.isReady && <Check className="w-3 h-3" />}
                    </div>
                    <span>{participant.isReady ? "Ready" : "Waiting"}</span>
                  </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Ready button & status */}
      <div className="flex flex-col items-center gap-5">
        <button
          onClick={() => onReadyToggle()}
          className={`nb-btn text-[var(--ts-lg)] !px-14 !py-4 ${
            isCurrentUserReady
              ? "nb-btn-success"
              : "nb-btn-secondary"
          }`}
        >
          {isCurrentUserReady ? "✓ Ready!" : "Ready Up"}
        </button>

        {team && missing > 0 && (
          <div className="text-center">
            <p className="text-[var(--ts-sm)] font-bold text-[var(--text-secondary)]">
              Waiting for {missing} more {missing === 1 ? "teammate" : "teammates"}. Share the code{" "}
              <span className="font-mono font-black text-[var(--secondary)] tracking-widest">{team.code}</span>.
            </p>
            {isHost && onLockRoster && participants.length >= 1 && (
              <button onClick={onLockRoster} className="nb-btn nb-btn-ghost mt-3">
                <Lock className="w-4 h-4" /> Start with {participants.length} {participants.length === 1 ? "player" : "players"}
              </button>
            )}
          </div>
        )}

        {/* Progress */}
        <div className="w-full max-w-xs">
          <div className="flex items-center justify-between text-[var(--ts-xs)] font-bold text-[var(--text-muted)] mb-2">
            <span>{readyCount}/{playing.length} ready</span>
            {allReady && (
              <span className="text-[var(--success)] animate-pulse">
                Starting countdown...
              </span>
            )}
          </div>
          <div className="h-3 rounded-md bg-white border-2 border-[var(--border)] overflow-hidden">
            <div
              className="h-full transition-all duration-500 ease-out"
              style={{
                width: `${(readyCount / Math.max(playing.length, 1)) * 100}%`,
                background: allReady ? "var(--success)" : "var(--secondary)",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
