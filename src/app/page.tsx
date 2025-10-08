"use client";
import TypingArea from "@/components/TypingArea";
import { useState } from "react";

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
    <>
      <div className="min-h-[15vh] flex justify-center items-center mt-12">
        <div className="flex flex-row gap-12 justify-center items-center text-2xl text-secondary transition-all duration-300 ease-out" style={!buttonFlag ? { opacity: 0, cursor: 'default' } : { opacity: 1 }}>
          <button
            onClick={() => buttonFlag ? handleTimeButtons(15) : undefined}
            className={`transition-colors ${buttonFlag ? 'cursor-pointer' : 'cursor-default'} ${activeTime === 15 ? 'text-accent-primary hover:text-accent-secondary' : 'hover:text-accent-secondary'}`}
            disabled={!buttonFlag}
          >
            <span>15</span>
          </button>
          <button
            onClick={() => buttonFlag ? handleTimeButtons(30) : undefined}
            className={`transition-colors ${buttonFlag ? 'cursor-pointer' : 'cursor-default'} ${activeTime === 30 ? 'text-accent-primary hover:text-accent-secondary' : 'hover:text-accent-secondary'}`}
            disabled={!buttonFlag}
          >
            <span>30</span>
          </button>
          <button
            onClick={() => buttonFlag ? handleTimeButtons(45) : undefined}
            className={`transition-colors ${buttonFlag ? 'cursor-pointer' : 'cursor-default'} ${activeTime === 45 ? 'text-accent-primary hover:text-accent-secondary' : 'hover:text-accent-secondary'}`}
            disabled={!buttonFlag}
          >
            <span>45</span>
          </button>
          <button
            onClick={() => buttonFlag ? handleTimeButtons(60) : undefined}
            className={`transition-colors ${buttonFlag ? 'cursor-pointer' : 'cursor-default'} ${activeTime === 60 ? 'text-accent-primary hover:text-accent-secondary' : 'hover:text-accent-secondary'}`}
            disabled={!buttonFlag}
          >
            <span>60</span>
          </button>
        </div>
      </div>

      <TypingArea
        time={activeTime}
        testContent=""
        isTestActive={isTestActive}
        onTestStart={handleTestStart}
        onTestFinish={handleTestFinish}
        onTryAgain={handleTryAgain}
      />
    </>
  );
}
