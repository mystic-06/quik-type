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
      <div className="w-full max-w-4xl mx-auto p-6">
        <div className="bg-surface rounded-xl p-8 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-accent-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <h2 className="text-2xl font-bold text-primary mb-2">
            Calculating Results...
          </h2>
          <p className="text-secondary">
            Waiting for all players to finish the test
          </p>
        </div>
      </div>
    );
  }

  const currentUserResult = rankings.find(r => r.id === currentUserId);
  const isWinner = currentUserResult?.rank === 1;

  const getRankColor = (rank: number) => {
    switch (rank) {
      case 1: return "text-yellow-400"; // Gold
      case 2: return "text-gray-300"; // Silver
      case 3: return "text-amber-600"; // Bronze
      default: return "text-primary";
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
    <div className="w-full max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-primary mb-4">
          {isWinner ? "Congratulations!!" : "Race Complete!"}
        </h1>
        {currentUserResult && (
          <div className="bg-surface rounded-xl p-6 mb-6">
            <h2 className="text-2xl font-bold mb-4">Your Performance</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <p className="text-sm text-secondary mb-1">Rank</p>
                <p className={`text-3xl font-bold ${getRankColor(currentUserResult.rank)}`}>
                  {getRankIcon(currentUserResult.rank)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-secondary mb-1">WPM</p>
                <p className="text-3xl font-bold text-accent-secondary">
                  {currentUserResult.wpm}
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-secondary mb-1">Accuracy</p>
                <p className="text-3xl font-bold text-accent-secondary">
                  {currentUserResult.accuracy}%
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-secondary mb-1">Raw WPM</p>
                <p className="text-3xl font-bold text-text-secondary">
                  {currentUserResult.rawWpm}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Leaderboard */}
      <div className="bg-surface rounded-xl p-6">
        <h2 className="text-2xl font-bold text-primary mb-6 text-center">
          Final Rankings
        </h2>
        <div className="space-y-3">
          {rankings.map((player, index) => {
            const isCurrentUser = player.id === currentUserId;

            return (
              <div
                key={player.id}
                className={`flex items-center justify-between p-4 rounded-lg transition-all duration-200 ${isCurrentUser
                    ? "bg-accent-secondary bg-opacity-20 border-2 border-accent-primary"
                    : "bg-background hover:bg-surface"
                  }`}
              >
                <div className="flex items-center gap-4">
                  <div className={`text-2xl font-bold min-w-[3rem] text-center ${getRankColor(player.rank)}`}>
                    {getRankIcon(player.rank)}
                  </div>
                  <div>
                    <p className={`text-lg font-semibold ${isCurrentUser ? "text-surface" : "text-primary"}`}>
                      {player.username}
                      {isCurrentUser && (
                        <span className="px-2 py-1 text-xl bg-accent-secondary text-surface rounded">
                          (You)
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-6 text-right">
                  <div>
                    <p className="text-sm text-secondary">WPM</p>
                    <p className="text-xl font-bold text-accent-primary">
                      {player.wpm}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-secondary">Accuracy</p>
                    <p className="text-lg font-semibold text-accent-primary">
                      {player.accuracy}%
                    </p>
                  </div>
                  <div className="hidden md:block">
                    <p className="text-sm text-secondary">Raw WPM</p>
                    <p className="text-lg font-semibold text-text-secondary">
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
      <div className="flex justify-center gap-4 mt-8">
        {isHost && (
          <button
            onClick={onPlayAgain}
            className="px-8 py-3 bg-accent-primary text-background font-semibold rounded-lg hover:bg-accent-secondary transition-colors"
          >
            Start New Round
          </button>
        )}
        {!isHost && (
          <p className="text-secondary text-center py-3">
            Waiting for host to start a new round...
          </p>
        )}
        <button
          onClick={() => window.location.href = '/'}
          className="px-8 py-3 bg-surface text-primary font-semibold rounded-lg hover:bg-background transition-colors"
        >
          Leave Room
        </button>
      </div>
    </div>
  );
}