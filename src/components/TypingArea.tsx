import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { generate } from "random-words";
import { RotateCcw, Gauge, Crosshair, Zap } from "lucide-react";

interface TypingAreaProps {
  time: number;
  isTestActive: boolean;
  testContent: string;
  onTestStart: () => void;
  onTestFinish: () => void;
  onTryAgain?: () => void;
  onResultsSubmit?: (results: {
    wpm: number;
    rawWpm: number;
    accuracy: number;
    charactersTyped: number;
    completionPercentage: number;
  }) => void;
  isMultiplayer?: boolean;
}

type CharStatus = "untyped" | "correct" | "incorrect";

export default function TypingArea({
  time,
  isTestActive,
  testContent,
  onTestStart,
  onTestFinish,
  onTryAgain,
  onResultsSubmit,
  isMultiplayer = false,
}: TypingAreaProps) {
  const [userInput, setUserInput] = useState("");
  const [timeLeft, setTimeLeft] = useState(time);
  const [textSeed, setTextSeed] = useState(0);

  const testText = useMemo(() => {
    if (!testContent || testContent.length === 0) {
      return generate(200) as string[];
    } else {
      return testContent.split(" ");
    }
  }, [testContent, textSeed]);
  const fullText = useMemo(() => testText.join(" "), [testText]);
  const [lineOffset, setLineOffset] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const charRefs = useRef<Map<number, HTMLSpanElement>>(new Map());
  const resultsSubmittedRef = useRef<boolean>(false);
  const charStatuses = useMemo((): CharStatus[] => {
    return fullText.split("").map((char, index) => {
      if (index >= userInput.length) return "untyped";
      return userInput[index] === char ? "correct" : "incorrect";
    });
  }, [fullText, userInput]);

  const currentIndex = userInput.length;

  const wordStatuses = useMemo(() => {
    const words = testText;
    const typedWords = userInput.split(" ");
    const isTypingWord = !userInput.endsWith(" ");
    const completedWordsCount = isTypingWord
      ? typedWords.length - 1
      : typedWords.length;

    return words.map((word, i) => {
      if (i < completedWordsCount) {
        return typedWords[i] === word ? "correct" : "incorrect";
      }
      if (i === completedWordsCount && isTypingWord) {
        const partial = typedWords[typedWords.length - 1] || "";
        return word.startsWith(partial) ? "typing" : "incorrect";
      }
      return "untyped";
    });
  }, [testText, userInput]);

  const metrics = useMemo(() => {
    const typedCount = charStatuses.filter((s) => s !== "untyped").length;
    const correctCount = charStatuses.filter((s) => s === "correct").length;

    const completionPercentage = Math.round((typedCount / fullText.length) * 100);

    if (typedCount === 0) {
      return {
        accuracy: 0,
        rawWpm: 0,
        wpm: 0,
        charactersTyped: 0,
        completionPercentage: 0,
      };
    }

    const accuracy = Math.round((correctCount / typedCount) * 100 * 10) / 10;

    let elapsedSeconds;
    if (hasStarted) {
      elapsedSeconds = time - timeLeft;
    } else if (typedCount > 0) {
      elapsedSeconds = Math.max(time - timeLeft, 1);
    } else {
      elapsedSeconds = 0;
    }

    const elapsedMinutes = Math.max(elapsedSeconds / 60, 0.05);

    let rawWpm = 0;
    let wpm = 0;

    if (elapsedSeconds > 0) {
      rawWpm = Math.round(typedCount / 5 / elapsedMinutes);
      wpm = Math.round(correctCount / 5 / elapsedMinutes);
    }

    return {
      accuracy,
      rawWpm,
      wpm,
      charactersTyped: typedCount,
      completionPercentage,
    };
  }, [charStatuses, time, timeLeft, hasStarted, fullText.length]);

  const isComplete = timeLeft === 0 || userInput.length === fullText.length;

  useEffect(() => {
    setTimeLeft(time);
  }, [time]);

  useEffect(() => {
    if (isTestActive) {
      resultsSubmittedRef.current = false;
    }
  }, [isTestActive]);

  useEffect(() => {
    if (isTestActive && timeLeft > 0) {
      intervalRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            onTestFinish();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isTestActive, timeLeft, onTestFinish]);

  useEffect(() => {
    if (isComplete && isMultiplayer && onResultsSubmit && !resultsSubmittedRef.current) {
      const resultsToSubmit = {
        wpm: metrics.wpm,
        rawWpm: metrics.rawWpm,
        accuracy: metrics.accuracy,
        charactersTyped: metrics.charactersTyped,
        completionPercentage: metrics.completionPercentage,
      };

      resultsSubmittedRef.current = true;
      onResultsSubmit(resultsToSubmit);
    }
  }, [isComplete, isMultiplayer, onResultsSubmit, metrics, timeLeft, userInput.length, fullText.length, hasStarted]);

  useEffect(() => {
    const activeChar = charRefs.current.get(currentIndex);
    const container = containerRef.current;

    if (activeChar && container) {
      const charTop = activeChar.offsetTop;
      const containerHeight = container.clientHeight;

      if (charTop - lineOffset >= containerHeight - 60) {
        setLineOffset((prev) => prev + 48);
      }
    }
  }, [currentIndex, lineOffset]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;

      if (timeLeft === 0 || value.length > fullText.length) {
        return;
      }
      if (value.length > 0 && !hasStarted) {
        setHasStarted(true);
        if (!isTestActive) {
          onTestStart();
        }
      }

      setUserInput(value);
    },
    [timeLeft, fullText.length, isTestActive, onTestStart]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Backspace") {
        if (userInput.length === 0) {
          e.preventDefault();
          return;
        }
        const lastChar = userInput[userInput.length - 1];
        if (lastChar === " ") {
          const words = userInput.trim().split(" ");
          const lastWord = words[words.length - 1];
          const expectedWord = testText[words.length - 1];

          if (lastWord === expectedWord) {
            e.preventDefault();
          }
        }
      }
    },
    [userInput, testText]
  );

  const resetTest = useCallback(() => {
    setUserInput("");
    setTimeLeft(time);
    setLineOffset(0);
    setHasStarted(false);
    resultsSubmittedRef.current = false;
    charRefs.current.clear();

    if (!isMultiplayer) {
      setTextSeed((prev) => prev + 1);
    }

    if (onTryAgain) {
      onTryAgain();
    }

    inputRef.current?.focus();
  }, [time, isMultiplayer, onTryAgain]);

  const setCharRef = useCallback(
    (index: number) => (el: HTMLSpanElement | null) => {
      if (el) {
        charRefs.current.set(index, el);
      } else {
        charRefs.current.delete(index);
      }
    },
    []
  );

  // Timer progress
  const timerPercent = isTestActive ? ((time - timeLeft) / time) * 100 : 0;

  return (
    <div className="w-full max-w-5xl mx-auto">
      {/* Timer */}
      <div
        className="flex justify-center mb-6 transition-all duration-300"
        style={{
          opacity: isTestActive ? 1 : 0,
          transform: isTestActive ? "translateY(0)" : "translateY(-8px)",
        }}
      >
        <div className="nb-card-primary flex items-center gap-3 px-5 py-2">
          <span className="font-mono text-[var(--ts-2xl)] font-black tabular-nums">
            {timeLeft}
          </span>
          <span className="text-[var(--ts-xs)] font-bold uppercase">sec</span>
          {/* Progress bar */}
          <div className="w-24 h-2 bg-[var(--border)] rounded-sm overflow-hidden border border-[var(--border)]">
            <div
              className="h-full bg-white transition-all duration-1000 ease-linear"
              style={{ width: `${100 - timerPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Typing area */}
      <div
        ref={containerRef}
        className="relative h-56 nb-card p-6 md:p-8 overflow-hidden cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        <div
          key={textSeed}
          className="flex flex-wrap text-[22px] md:text-[26px] leading-[2.6rem] transition-transform duration-200 font-mono"
          style={{ transform: `translateY(-${lineOffset}px)` }}
        >
          {fullText.split("").map((char, index) => {
            const status = charStatuses[index];
            const isCurrent = index === currentIndex;

            let charClass = "text-[var(--text-muted)]";
            if (status === "correct") {
              charClass = "text-[var(--text)]";
            } else if (status === "incorrect") {
              charClass = "text-[var(--danger)] bg-[var(--danger)]/10";
            }

            return (
              <span
                key={index}
                id={`char-${index}`}
                ref={setCharRef(index)}
                className={`${charClass} ${isCurrent ? "relative" : ""}`}
              >
                {isCurrent && (
                  <span className="absolute left-0 top-[0.1em] w-[3px] h-[1.15em] bg-[var(--secondary)] caret-blink" />
                )}
                {char === " " ? "\u00A0" : char}
              </span>
            );
          })}
        </div>
      </div>

      {/* Results — Solo mode */}
      {isComplete && !isMultiplayer && (
        <div className="mt-8 animate-fade-in-up">
          <div className="nb-card p-8">
            <h3 className="text-center text-[var(--ts-xl)] font-black mb-8">
              Test Complete!
            </h3>

            <div className="grid grid-cols-3 gap-4 mb-8 stagger-children">
              {/* WPM */}
              <div className="nb-card-primary text-center p-5">
                <div className="flex items-center justify-center gap-1.5 mb-2">
                  <Gauge className="w-4 h-4" />
                  <p className="text-[var(--ts-xs)] font-bold uppercase">WPM</p>
                </div>
                <p className="text-[var(--ts-2xl)] font-black font-mono">
                  {metrics.wpm}
                </p>
              </div>
              {/* Raw WPM */}
              <div className="nb-card-flat text-center p-5">
                <div className="flex items-center justify-center gap-1.5 mb-2">
                  <Zap className="w-4 h-4 text-[var(--text-secondary)]" />
                  <p className="text-[var(--ts-xs)] font-bold uppercase text-[var(--text-muted)]">Raw WPM</p>
                </div>
                <p className="text-[var(--ts-2xl)] font-black font-mono text-[var(--text-secondary)]">
                  {metrics.rawWpm}
                </p>
              </div>
              {/* Accuracy */}
              <div className="text-center p-5 border-2 border-[var(--border)] rounded-[var(--radius)] bg-[var(--success)] text-white shadow-[var(--shadow)]">
                <div className="flex items-center justify-center gap-1.5 mb-2">
                  <Crosshair className="w-4 h-4" />
                  <p className="text-[var(--ts-xs)] font-bold uppercase">Accuracy</p>
                </div>
                <p className="text-[var(--ts-2xl)] font-black font-mono">
                  {metrics.accuracy}%
                </p>
              </div>
            </div>

            <div className="flex justify-center">
              <button
                onClick={resetTest}
                className="nb-btn nb-btn-secondary text-[var(--ts-base)] !px-8 !py-3"
              >
                <RotateCcw className="w-4 h-4" />
                Try Again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Multiplayer completion */}
      {isComplete && isMultiplayer && (
        <div className="mt-8 animate-fade-in-up">
          <div className="nb-card p-8">
            <h3 className="text-center text-[var(--ts-xl)] font-black mb-2">
              Test Complete!
            </h3>
            <p className="text-center text-[var(--text-secondary)] mb-6 text-[var(--ts-sm)]">
              Results submitted. Waiting for other players...
            </p>
            <div className="grid grid-cols-3 gap-4 stagger-children">
              <div className="nb-card-primary text-center p-5">
                <div className="flex items-center justify-center gap-1.5 mb-2">
                  <Gauge className="w-4 h-4" />
                  <p className="text-[var(--ts-xs)] font-bold uppercase">WPM</p>
                </div>
                <p className="text-[var(--ts-2xl)] font-black font-mono">{metrics.wpm}</p>
              </div>
              <div className="nb-card-flat text-center p-5">
                <div className="flex items-center justify-center gap-1.5 mb-2">
                  <Zap className="w-4 h-4 text-[var(--text-secondary)]" />
                  <p className="text-[var(--ts-xs)] font-bold uppercase text-[var(--text-muted)]">Raw WPM</p>
                </div>
                <p className="text-[var(--ts-2xl)] font-black font-mono text-[var(--text-secondary)]">{metrics.rawWpm}</p>
              </div>
              <div className="text-center p-5 border-2 border-[var(--border)] rounded-[var(--radius)] bg-[var(--success)] text-white shadow-[var(--shadow)]">
                <div className="flex items-center justify-center gap-1.5 mb-2">
                  <Crosshair className="w-4 h-4" />
                  <p className="text-[var(--ts-xs)] font-bold uppercase">Accuracy</p>
                </div>
                <p className="text-[var(--ts-2xl)] font-black font-mono">{metrics.accuracy}%</p>
              </div>
            </div>

            {/* Waiting spinner */}
            <div className="flex justify-center mt-6">
              <div className="w-6 h-6 border-3 border-[var(--border)] border-t-[var(--primary)] rounded-full animate-spin" />
            </div>
          </div>
        </div>
      )}

      {/* Hidden input */}
      <input
        ref={inputRef}
        type="text"
        value={userInput}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        disabled={isComplete}
        className="sr-only"
        autoFocus
        aria-label="Type here"
      />
    </div>
  );
}
