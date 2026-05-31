"use client";
import TypingArea from "@/components/TypingArea";
import { useState } from "react";
import { Timer, Keyboard } from "lucide-react";

const TIME_OPTIONS = [15, 30, 45, 60];

export default function Home() {
  const [activeTime, setTime] = useState(15);
  const [isTestActive, setTestStatus] = useState(false);
  const [buttonFlag, setButtonFlag] = useState(true);

  function handleTimeButtons(time: number) {
    setTime(time);
    setTestStatus(false);
    setButtonFlag(true);
  }

  function handleTestStart() {
    setTestStatus(true);
    setButtonFlag(false);
  }

  function handleTestFinish() {
    setTestStatus(false);
  }

  function handleTryAgain() {
    setTestStatus(false);
    setButtonFlag(true);
  }

  return (
    <div className="py-10 animate-fade-in-up">
      {/* Timer selector */}
      <div
        className="flex justify-center mb-8 transition-all duration-300"
        style={{
          opacity: buttonFlag ? 1 : 0,
          transform: buttonFlag ? "translateY(0)" : "translateY(-8px)",
          pointerEvents: buttonFlag ? "auto" : "none",
        }}
      >
        <div className="nb-card-flat flex items-center gap-0 p-1">
          <div className="flex items-center gap-1.5 px-3 text-[var(--text-muted)]">
            <Timer className="w-4 h-4" />
            <span className="text-[var(--ts-xs)] font-bold uppercase tracking-wider">Time</span>
          </div>
          <div className="w-0.5 h-7 bg-[var(--border)] mx-1" />
          {TIME_OPTIONS.map((time) => (
            <button
              key={time}
              onClick={() => handleTimeButtons(time)}
              disabled={!buttonFlag}
              className={`px-5 py-2 font-mono text-[var(--ts-base)] font-bold cursor-pointer transition-all duration-100 rounded-md
                ${activeTime === time
                  ? "bg-[var(--primary)] border-2 border-[var(--border)] shadow-[2px_2px_0_var(--border)]"
                  : "border-2 border-transparent text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--surface-alt)]"
                }`}
            >
              {time}
            </button>
          ))}
        </div>
      </div>

      {/* Typing area */}
      <TypingArea
        time={activeTime}
        testContent=""
        isTestActive={isTestActive}
        onTestStart={handleTestStart}
        onTestFinish={handleTestFinish}
        onTryAgain={handleTryAgain}
      />

      {/* Hint */}
      <div
        className="mt-8 flex items-center justify-center gap-2 text-[var(--text-muted)] text-[var(--ts-sm)] transition-all duration-300"
        style={{ opacity: buttonFlag && !isTestActive ? 0.7 : 0 }}
      >
        <Keyboard className="w-4 h-4" />
        <span className="font-medium">Start typing to begin the test</span>
      </div>
    </div>
  );
}
