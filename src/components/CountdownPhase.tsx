import { useEffect, useState } from "react";

type props = {
  countdown?: number;
};

export default function CountdownPhase({ countdown = 5 }: props) {
  const [timeLeft, setTimeLeft] = useState(countdown);

  useEffect(() => {
    if (timeLeft <= 0) return;

    const timer = setTimeout(() => {
      setTimeLeft(timeLeft - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [timeLeft]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <div className="relative flex items-center justify-center">
        {/* Outer decorative border */}
        <div className="absolute w-44 h-44 border-4 border-[var(--border)] rounded-lg rotate-6" />
        <div className="absolute w-48 h-48 border-2 border-[var(--text-muted)] rounded-lg -rotate-3" />

        {/* Main number */}
        <div className="w-36 h-36 nb-card-primary flex items-center justify-center !rounded-lg">
          <span
            key={timeLeft}
            className="text-7xl font-black font-mono animate-bounce-in"
          >
            {timeLeft}
          </span>
        </div>
      </div>

      <p className="mt-8 text-[var(--ts-lg)] font-bold text-[var(--text-secondary)]">
        Get ready...
      </p>
    </div>
  );
}
