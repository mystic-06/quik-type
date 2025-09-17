import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { generate } from 'random-words';

interface TypingAreaProps {
    time: number;
    isTestActive: boolean;
    onTestStart: () => void;
    onTestFinish: () => void;
}

type CharStatus = 'untyped' | 'correct' | 'incorrect';

export default function TypingArea({ time, isTestActive, onTestStart, onTestFinish }: TypingAreaProps) {
    // Generate test text once
    const testText = useMemo(() => generate(200) as string[], []);
    const fullText = useMemo(() => testText.join(' '), [testText]);
    
    // Core state
    const [userInput, setUserInput] = useState('');
    const [timeLeft, setTimeLeft] = useState(time);
    const [lineOffset, setLineOffset] = useState(0);
    const [hasStarted, setHasStarted] = useState(false);
    
    // Refs
    const inputRef = useRef<HTMLInputElement>(null);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const charRefs = useRef<Map<number, HTMLSpanElement>>(new Map());
    
    // Derived state using memos for performance
    const charStatuses = useMemo((): CharStatus[] => {
        return fullText.split('').map((char, index) => {
            if (index >= userInput.length) return 'untyped';
            return userInput[index] === char ? 'correct' : 'incorrect';
        });
    }, [fullText, userInput]);
    
    const currentIndex = userInput.length;
    
    const wordStatuses = useMemo(() => {
        const words = testText;
        const typedWords = userInput.split(' ');
        const isTypingWord = !userInput.endsWith(' ');
        const completedWordsCount = isTypingWord ? typedWords.length - 1 : typedWords.length;
        
        return words.map((word, i) => {
            if (i < completedWordsCount) {
                return typedWords[i] === word ? 'correct' : 'incorrect';
            }
            if (i === completedWordsCount && isTypingWord) {
                const partial = typedWords[typedWords.length - 1] || '';
                return word.startsWith(partial) ? 'typing' : 'incorrect';
            }
            return 'untyped';
        });
    }, [testText, userInput]);
    
    const metrics = useMemo(() => {
        const typedCount = charStatuses.filter(s => s !== 'untyped').length;
        const correctCount = charStatuses.filter(s => s === 'correct').length;
        
        if (typedCount === 0) {
            return { accuracy: 0, rawWpm: 0, wpm: 0 };
        }
        
        const elapsedTime = hasStarted ? (time - timeLeft) / 60 : time / 60;
        if (elapsedTime === 0) {
            return { accuracy: 0, rawWpm: 0, wpm: 0 };
        }
        
        const accuracy = (correctCount / typedCount) * 100;
        const rawWpm = (typedCount / 5) / elapsedTime;
        const wpm = (correctCount / 5) / elapsedTime;
        
        return { 
            accuracy: Math.round(accuracy * 10) / 10,
            rawWpm: Math.round(rawWpm),
            wpm: Math.round(wpm)
        };
    }, [charStatuses, time, timeLeft, hasStarted]);
    
    const isComplete = timeLeft === 0 || userInput.length === fullText.length;
    
    // Update time when prop changes
    useEffect(() => {
        setTimeLeft(time);
    }, [time]);
    
    // Handle timer
    useEffect(() => {
        if (isTestActive && timeLeft > 0) {
            intervalRef.current = setInterval(() => {
                setTimeLeft(prev => {
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
    
    // Handle line scrolling
    useEffect(() => {
        const activeChar = charRefs.current.get(currentIndex);
        const container = containerRef.current;
        
        if (activeChar && container) {
            const charTop = activeChar.offsetTop;
            const containerHeight = container.clientHeight;
            
            if (charTop - lineOffset >= containerHeight - 60) {
                setLineOffset(prev => prev + 48);
            }
        }
    }, [currentIndex, lineOffset]);
    
    // Handle input change
    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        
        // Prevent typing after test ends
        if (timeLeft === 0 || value.length > fullText.length) {
            return;
        }
        
        // Start test on first character
        if (!isTestActive && value.length > 0) {
            setHasStarted(true);
            onTestStart();
        }
        
        setUserInput(value);
    }, [timeLeft, fullText.length, isTestActive, onTestStart]);
    
    // Handle backspace restrictions
    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace') {
            // Prevent backspace at start
            if (userInput.length === 0) {
                e.preventDefault();
                return;
            }
            
            // Prevent backspace from going back to previous word if current word is complete
            const lastChar = userInput[userInput.length - 1];
            if (lastChar === ' ') {
                const words = userInput.trim().split(' ');
                const lastWord = words[words.length - 1];
                const expectedWord = testText[words.length - 1];
                
                if (lastWord === expectedWord) {
                    e.preventDefault();
                }
            }
        }
    }, [userInput, testText]);
    
    // Reset test
    const resetTest = useCallback(() => {
        setUserInput('');
        setTimeLeft(time);
        setLineOffset(0);
        setHasStarted(false);
        inputRef.current?.focus();
    }, [time]);
    
    // Set char ref
    const setCharRef = useCallback((index: number) => (el: HTMLSpanElement | null) => {
        if (el) {
            charRefs.current.set(index, el);
        } else {
            charRefs.current.delete(index);
        }
    }, []);
    
    return (
        <div className="w-full max-w-7xl mx-auto">
            {/* Timer */}
            <div 
                className="text-accent-primary font-space-mono text-4xl mb-4 text-center transition-all duration-300"
                style={{ opacity: isTestActive ? 1 : 0 }}
            >
                {timeLeft}s
            </div>
            
            {/* Typing area */}
            <div 
                ref={containerRef}
                className="h-56 bg-surface mx-auto font-space-mono p-6 rounded-lg overflow-hidden relative cursor-text"
                onClick={() => inputRef.current?.focus()}
            >
                <div 
                    className="flex flex-wrap text-3xl leading-relaxed transition-transform duration-200"
                    style={{ transform: `translateY(-${lineOffset}px)` }}
                >
                    {fullText.split('').map((char, index) => {
                        const status = charStatuses[index];
                        const isCurrent = index === currentIndex;
                        
                        let className = 'text-gray-500';
                        if (status === 'correct') {
                            className = 'text-gray-300';
                        } else if (status === 'incorrect') {
                            className = 'text-red-400';
                        } else if (isCurrent) {
                            className = 'relative after:absolute after:left-0 after:top-0 after:w-0.5 after:h-full after:bg-blue-300 after:animate-pulse';
                        }
                        
                        return (
                            <span
                                key={index}
                                id={`char-${index}`}
                                ref={setCharRef(index)}
                                className={className}
                            >
                                {char === ' ' ? '\u00A0' : char}
                            </span>
                        );
                    })}
                </div>
            </div>
            
            {/* Results */}
            {isComplete && (
                <div className="mt-6 text-center space-y-4">
                    <div className="bg-surface rounded-lg p-4 shadow-md">
                        <h3 className="text-lg font-semibold mb-4 text-primary">Test Complete!</h3>
                        <div className="grid grid-cols-3 gap-4 mb-4">
                            <div>
                                <p className="text-sm text-gray-400">WPM</p>
                                <p className="text-2xl font-bold text-blue-400">{metrics.wpm}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-400">Raw WPM</p>
                                <p className="text-2xl font-bold text-blue-300">{metrics.rawWpm}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-400">Accuracy</p>
                                <p className="text-2xl font-bold text-green-300">{metrics.accuracy}%</p>
                            </div>
                        </div>
                        <button 
                            onClick={resetTest}
                            className="px-6 py-2 bg-accent-secondary text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
                        >
                            Try Again
                        </button>
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