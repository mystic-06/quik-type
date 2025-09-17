"use client";

interface Participant {
  id: string;
  username: string;
  isReady: boolean;
  isHost: boolean;
}

interface SetupPhaseProps {
  isHost: boolean;
  roomConfig: {
    timerDuration: number;
  };
  participants: Participant[];
  onConfigChange: (config: { timerDuration: number }) => void;
  onReadyToggle: () => void;
  currentUserId: string;
}

const TIMER_OPTIONS = [15, 30, 60, 120];

export default function SetupPhase({
  isHost,
  roomConfig,
  participants,
  onConfigChange,
  onReadyToggle,
  currentUserId
}: SetupPhaseProps) {
  const currentUser = participants.find(p => p.id === currentUserId);
  const isCurrentUserReady = currentUser?.isReady || false;

  const handleTimerChange = (duration: number) => {
    if (isHost) {
      onConfigChange({ timerDuration: duration });
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-6">
      {/* Timer Configuration Section - Host Only */}
      {isHost && (
        <div className="bg-surface rounded-xl p-6 mb-6">
          <h2 className="text-2xl font-bold text-primary mb-4">Test Configuration</h2>
          <div className="mb-4">
            <label className="block text-lg text-primary mb-3">Timer Duration:</label>
            <div className="flex gap-3 flex-wrap">
              {TIMER_OPTIONS.map((duration) => (
                <button
                  key={duration}
                  onClick={() => handleTimerChange(duration)}
                  className={`px-4 py-2 rounded-lg text-lg font-medium transition-all duration-200 ${
                    roomConfig.timerDuration === duration
                      ? 'bg-accent-primary text-background'
                      : 'bg-background text-primary hover:bg-accent-primary hover:text-background'
                  }`}
                >
                  {duration}s
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Non-host view of current configuration */}
      {!isHost && (
        <div className="bg-surface rounded-xl p-6 mb-6">
          <h2 className="text-2xl font-bold text-primary mb-4">Test Configuration</h2>
          <div className="text-lg text-secondary">
            Timer Duration: <span className="text-accent-primary font-medium">{roomConfig.timerDuration}s</span>
          </div>
        </div>
      )}

      {/* Participants List */}
      <div className="bg-surface rounded-xl p-6 mb-6">
        <h2 className="text-2xl font-bold text-primary mb-4">
          Participants ({participants.length})
        </h2>
        <div className="space-y-3">
          {participants.map((participant) => (
            <div
              key={participant.id}
              className="flex items-center justify-between p-3 bg-background rounded-lg"
            >
              <div className="flex items-center gap-3">
                <div className="text-lg font-medium text-primary">
                  {participant.username}
                  {participant.isHost && (
                    <span className="ml-2 px-2 py-1 text-sm bg-accent-primary text-background rounded">
                      Host
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
                    participant.isReady 
                      ? 'bg-accent-secondary border-accent-secondary shadow-lg' 
                      : 'bg-transparent border-text-secondary'
                  }`}
                />
                <span
                  className={`text-lg font-medium transition-colors duration-200 ${
                    participant.isReady ? 'text-accent-secondary' : 'text-secondary'
                  }`}
                >
                  {participant.isReady ? '✓ Ready' : 'Not Ready'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ready Button */}
      <div className="text-center">
        <button
          onClick={onReadyToggle}
          className={`px-12 py-4 text-2xl font-bold rounded-xl transition-all duration-200 transform hover:scale-105 ${
            isCurrentUserReady
              ? 'bg-accent-secondary text-background hover:opacity-80 shadow-lg'
              : 'bg-accent-primary text-background hover:opacity-80 shadow-md'
          }`}
        >
          {isCurrentUserReady ? '✓ Ready!' : 'Ready Up'}
        </button>
      </div>

      {/* Status Message */}
      <div className="text-center mt-6">
        {participants.every(p => p.isReady) && participants.length > 1 ? (
          <div className="bg-accent-secondary bg-opacity-20 border border-accent-secondary rounded-lg p-4">
            <p className="text-accent-secondary text-xl font-bold">
              🎉 All players ready! Starting countdown...
            </p>
          </div>
        ) : (
          <div className="bg-surface rounded-lg p-4">
            <p className="text-secondary text-lg">
              Waiting for {participants.filter(p => !p.isReady).length} player(s) to ready up...
            </p>
            <div className="flex justify-center gap-2 mt-2">
              {participants.map((p) => (
                <div
                  key={p.id}
                  className={`w-3 h-3 rounded-full transition-all duration-200 ${
                    p.isReady ? 'bg-accent-secondary' : 'bg-text-secondary'
                  }`}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}