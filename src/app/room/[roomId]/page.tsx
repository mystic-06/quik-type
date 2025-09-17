"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import SetupPhase from "@/components/SetupPhase";
import { useSocket } from "@/hooks/useSocket";

export default function Room(){
    const params = useParams();
    const roomId = params.roomId as string;
    const { socket, isConnected, roomState, joinRoom, configureTest, toggleReady } = useSocket();
    const [currentUserId, setCurrentUserId] = useState<string>("");
    const [hasJoined, setHasJoined] = useState(false);
    const [mockParticipants, setMockParticipants] = useState(() => [
        {
            id: "mock-1",
            username: typeof window !== 'undefined' ? (localStorage.getItem("username") || "Player") : "Player",
            isReady: false,
            isHost: true
        },
        {
            id: "mock-2", 
            username: "TestPlayer2",
            isReady: false,
            isHost: false
        }
    ]);
    const [mockConfig, setMockConfig] = useState({ timerDuration: 30 });

    // Join room on component mount
    useEffect(() => {
        const username = localStorage.getItem("username") || "Player";
        if (!hasJoined && roomId) {
            joinRoom(roomId, username);
            setHasJoined(true);
        }
    }, [roomId, joinRoom, hasJoined]);

    // Set current user ID when socket connects
    useEffect(() => {
        if (socket?.id) {
            setCurrentUserId(socket.id);
        }
    }, [socket?.id]);

    const handleConfigChange = (config: { timerDuration: number }) => {
        if (isConnected) {
            configureTest(config);
        } else {
            // Update mock config for offline mode
            setMockConfig(config);
        }
    };

    const handleReadyToggle = () => {
        if (isConnected) {
            toggleReady();
        } else {
            // Update mock participants for offline mode
            setMockParticipants(prev => 
                prev.map(p => 
                    p.id === effectiveCurrentUserId 
                        ? { ...p, isReady: !p.isReady }
                        : p
                )
            );
        }
    };

    // Use socket room state or fallback to mock data for development
    const phase = roomState?.phase || "setup";
    const roomConfig = roomState?.config || mockConfig;
    const participants = roomState?.participants || mockParticipants;
    const effectiveCurrentUserId = currentUserId || "mock-user-1";
    
    const currentUser = participants.find(p => p.id === effectiveCurrentUserId);
    const isHost = currentUser?.isHost || false;

    // Show connection status
    if (!isConnected && hasJoined) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="text-center">
                    <div className="text-2xl text-primary mb-4">Connecting to room...</div>
                    <div className="text-secondary">Please wait while we connect you to the server.</div>
                </div>
            </div>
        );
    }

    return(
        <div className="min-h-screen bg-background px-4 py-8">
            <div className="max-w-6xl mx-auto">
                <h1 className="text-4xl font-bold text-center text-primary mb-4">
                    Room: <span className="text-accent-primary">{roomId}</span>
                </h1>
                
                {/* Connection Status */}
                <div className="text-center mb-6">
                    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
                        isConnected 
                            ? 'bg-accent-secondary bg-opacity-20 text-accent-secondary' 
                            : 'bg-text-secondary bg-opacity-20 text-secondary'
                    }`}>
                        <div className={`w-2 h-2 rounded-full ${
                            isConnected ? 'bg-accent-secondary' : 'bg-text-secondary'
                        }`} />
                        {isConnected ? 'Connected' : 'Offline Mode'}
                    </div>
                </div>
                
                {phase === "setup" && (
                    <SetupPhase
                        isHost={isHost}
                        roomConfig={roomConfig}
                        participants={participants}
                        onConfigChange={handleConfigChange}
                        onReadyToggle={handleReadyToggle}
                        currentUserId={effectiveCurrentUserId}
                    />
                )}
                
                {phase === "countdown" && (
                    <div className="text-center">
                        <div className="text-6xl font-bold text-accent-primary">
                            Countdown Phase
                        </div>
                    </div>
                )}
                
                {phase === "test" && (
                    <div className="text-center">
                        <div className="text-6xl font-bold text-accent-secondary">
                            Test Phase
                        </div>
                    </div>
                )}
                
                {phase === "results" && (
                    <div className="text-center">
                        <div className="text-6xl font-bold text-accent-primary">
                            Results Phase
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}