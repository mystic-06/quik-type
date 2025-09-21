"use client";
import { useEffect, useRef, useState } from "react";

interface useTestingPhaseReturn 
{
    time: number;
    isTestActive: boolean;
    onTestStart: () => void;
    onTestFinish: () => void;
}

export default function useTestingPhase() : useTestingPhaseReturn {
    const [activeTime,setTime] = useState(15);
    return();
}