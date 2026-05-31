import { Trophy, Gauge, Crosshair, Zap, RotateCcw, LogOut, Crown, Medal } from "lucide-react";

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

interface ResultPhaseProps {
  rankings: PlayerResult[] | null;
  currentUserId: string;
  isHost?: boolean;
  onPlayAgain?: () => void;
}

export default function ResultPhase({ rankings, currentUserId, isHost = false, onPlayAgain }: ResultPhaseProps) {
  if (!rankings || rankings.length === 0) {
    return (
      <div className="w-full max-w-4xl mx-auto p-6 animate-fade-in-up">
        <div className="nb-card p-10 text-center">
          <div className="w-10 h-10 border-3 border-[var(--border)] border-t-[var(--primary)] rounded-full mx-auto mb-5 animate-spin" />
          <h2 className="text-[var(--ts-xl)] font-black mb-2">
            Calculating Results...
          </h2>
          <p className="text-[var(--text-secondary)] text-[var(--ts-sm)]">
            Waiting for all players to finish
          </p>
        </div>
      </div>
    );
  }

  const currentUserResult = rankings.find((r) => r.id === currentUserId);
  const isWinner = currentUserResult?.rank === 1;

  const getRankBg = (rank: number) => {
    switch (rank) {
      case 1: return "bg-[var(--primary)]";
      case 2: return "bg-[#E2E8F0]";
      case 3: return "bg-[var(--warning)]/20";
      default: return "bg-white";
    }
  };

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1: return "🥇";
      case 2: return "🥈";
      case 3: return "🥉";
      default: return `#${rank}`;
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-6 animate-fade-in-up">
      {/* Winner banner */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-[var(--primary)] border-2 border-[var(--border)] rounded-lg shadow-[var(--shadow)] mb-4">
          <Trophy className="w-8 h-8" />
        </div>
        <h1 className="text-[var(--ts-2xl)] font-black">
          {isWinner ? "You Won! 🎉" : "Race Complete!"}
        </h1>
      </div>

      {/* Your performance */}
      {currentUserResult && (
        <div className="nb-card p-8 mb-8">
          <h2 className="text-[var(--ts-xs)] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-5 text-center">
            Your Performance
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
            <div className="nb-card-primary text-center p-4">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Medal className="w-3.5 h-3.5" />
                <span className="text-[var(--ts-xs)] font-bold uppercase">Rank</span>
              </div>
              <p className="text-[var(--ts-xl)] font-black font-mono">
                {getRankIcon(currentUserResult.rank)}
              </p>
            </div>
            <div className="nb-card-secondary text-center p-4">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Gauge className="w-3.5 h-3.5" />
                <span className="text-[var(--ts-xs)] font-bold uppercase">WPM</span>
              </div>
              <p className="text-[var(--ts-xl)] font-black font-mono">
                {currentUserResult.wpm}
              </p>
            </div>
            <div className="text-center p-4 border-2 border-[var(--border)] rounded-[var(--radius)] bg-[var(--success)] text-white shadow-[var(--shadow)]">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Crosshair className="w-3.5 h-3.5" />
                <span className="text-[var(--ts-xs)] font-bold uppercase">Accuracy</span>
              </div>
              <p className="text-[var(--ts-xl)] font-black font-mono">
                {currentUserResult.accuracy}%
              </p>
            </div>
            <div className="nb-card-flat text-center p-4">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Zap className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                <span className="text-[var(--ts-xs)] font-bold uppercase text-[var(--text-muted)]">Raw WPM</span>
              </div>
              <p className="text-[var(--ts-xl)] font-black font-mono text-[var(--text-secondary)]">
                {currentUserResult.rawWpm}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Leaderboard */}
      <div className="nb-card p-6 mb-8">
        <h2 className="text-[var(--ts-xs)] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-5 text-center">
          Final Rankings
        </h2>
        <div className="space-y-2 stagger-children">
          {rankings.map((player) => {
            const isCurrentUser = player.id === currentUserId;

            return (
              <div
                key={player.id}
                className={`flex items-center justify-between p-4 rounded-md border-2 border-[var(--border)] transition-all duration-100 ${
                  isCurrentUser ? getRankBg(player.rank) : "bg-white"
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-md flex items-center justify-center text-lg font-black border-2 border-[var(--border)] ${getRankBg(player.rank)}`}>
                    {getRankIcon(player.rank)}
                  </div>
                  <div>
                    <p className="text-[var(--ts-base)] font-bold">
                      {player.username}
                      {isCurrentUser && (
                        <span className="nb-badge ml-2 bg-[var(--secondary)] text-white text-[10px]">You</span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-6 text-right">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-muted)]">WPM</p>
                    <p className="text-[var(--ts-lg)] font-black font-mono text-[var(--secondary)]">
                      {player.wpm}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-muted)]">Acc</p>
                    <p className="text-[var(--ts-base)] font-bold font-mono">
                      {player.accuracy}%
                    </p>
                  </div>
                  <div className="hidden md:block">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-muted)]">Raw</p>
                    <p className="text-[var(--ts-base)] font-bold font-mono text-[var(--text-secondary)]">
                      {player.rawWpm}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-center gap-4">
        {isHost && (
          <button
            onClick={onPlayAgain}
            className="nb-btn nb-btn-primary text-[var(--ts-sm)]"
          >
            <RotateCcw className="w-4 h-4" />
            New Round
          </button>
        )}
        {!isHost && (
          <p className="py-3 text-[var(--text-secondary)] text-[var(--ts-sm)] flex items-center gap-2 font-medium">
            <Crown className="w-4 h-4 text-[var(--warning)]" />
            Waiting for host to start a new round...
          </p>
        )}
        <button
          onClick={() => (window.location.href = "/")}
          className="nb-btn nb-btn-ghost text-[var(--ts-sm)]"
        >
          <LogOut className="w-4 h-4" />
          Leave
        </button>
      </div>
    </div>
  );
}