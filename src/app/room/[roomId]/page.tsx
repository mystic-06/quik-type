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
    const [mockConfig, setMockConfig] = useState({ timerDuration: 15 });

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
        console.log('Ready toggle clicked!', { isConnected, effectiveCurrentUserId, roomState });
        
        if (isConnected && roomState) {
            console.log('Calling toggleReady via socket');
            toggleReady();
        } else {
            console.log('Updating mock participants for offline mode');
            // Update mock participants for offline mode
            setMockParticipants(prev => {
                const updated = prev.map(p => 
                    p.id === effectiveCurrentUserId 
                        ? { ...p, isReady: !p.isReady }
                        : p
                );
                console.log('Updated mock participants:', updated);
                return updated;
            });
        }
    };

    // Use socket room state or fallback to mock data for development
    const phase = roomState?.phase || "setup";
    const roomConfig = roomState?.config || mockConfig;
    const participants = (isConnected && roomState?.participants) ? roomState.participants : mockParticipants;
    const effectiveCurrentUserId = currentUserId || "mock-1";
    
    const currentUser = participants.find(p => p.id === effectiveCurrentUserId);
    const isHost = currentUser?.isHost || false;

    // Debug logging (can be removed in production)
    if (process.env.NODE_ENV === 'development') {
        console.log('Room state debug:', {
            isConnected,
            hasRoomState: !!roomState,
            currentUserId,
            effectiveCurrentUserId,
            participantsCount: participants.length,
            currentUser,
            isHost
        });
    }

    // Show connection status only briefly, then allow offline mode
    // Removed the blocking connection screen to allow offline mode

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
                            ? 'bg-surface bg-opacity-20 text-accent-secondary' 
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