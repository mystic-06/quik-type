"use client";
import TypingArea from "@/components/TypingArea";
import { useState } from "react";

export default function Home() {
  const [activeTime,setTime] = useState(15);
  const [isTestActive, setTestStatus] = useState(false);

  function handleTimeButtons(time: number) {
    setTime(time);
    setTestStatus(false);
  }

  function handleTestStart() {
    setTestStatus(true);
  }

  function handleTestFinish() {
    setTestStatus(false);
  }

  return (
    <>
      <div className="min-h-[15vh] flex justify-center items-center mt-12">
        <div className="flex flex-row gap-12 justify-center items-center text-2xl text-secondary transition-all duration-300 ease-out" style={isTestActive? {opacity : 0 , cursor : 'default'} : {opacity : 1}}>
        <button 
          onClick={() => handleTimeButtons(15)}
          className={`transition-colors cursor-pointer ${activeTime === 15 ? 'text-accent-primary hover:text-accent-secondary' : 'hover:text-accent-secondary'}`}
          style={isTestActive? {cursor : 'default'} : {cursor : 'pointer'}}
        >
          <span>15</span>
        </button>
        <button 
          onClick={() => handleTimeButtons(30)}
          className={`transition-colors cursor-pointer ${activeTime === 30 ? 'text-accent-primary hover:text-accent-secondary' : 'hover:text-accent-secondary'}`}
          style={isTestActive? {cursor : 'default'} : {cursor : 'pointer'}}
        >
          <span>30</span>
        </button>
        <button 
          onClick={() => handleTimeButtons(45)}
          className={`transition-colors cursor-pointer ${activeTime === 45 ? 'text-accent-primary hover:text-accent-secondary' : 'hover:text-accent-secondary'}`}
          style={isTestActive? {cursor : 'default'} : {cursor : 'pointer'}}
        >
          <span>45</span>
        </button>
        <button 
          onClick={() => handleTimeButtons(60)}
          className={`transition-colors cursor-pointer ${activeTime === 60 ? 'text-accent-primary hover:text-accent-secondary' : 'hover:text-accent-secondary'}`}
          style={isTestActive? {cursor : 'default'} : {cursor : 'pointer'}}
        >
          <span>60</span>
        </button>
        </div>
      </div>

      <TypingArea 
        time={activeTime} 
        isTestActive={isTestActive}
        onTestStart={handleTestStart}
        onTestFinish={handleTestFinish}
      />
    </>
  );
}
