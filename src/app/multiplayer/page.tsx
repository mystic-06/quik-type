"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Multiplayer() {
  const [username, setUsername] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const router = useRouter();

  const handleCreateRoom = () => {
    if (!username.trim()) return alert("Enter a username!");
    localStorage.setItem("username", username);

    const roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    router.push(`/room/${roomCode}`);
  };

  const handleJoinRoom = () => {
    if (!username.trim()) return alert("Enter a username!");
    if (!roomCode.trim()) return alert("Enter a room code!");
    localStorage.setItem("username", username);

    router.push(`/room/${roomCode.toUpperCase()}`);
  };
  return (
    <div className="min-h-screen bg-background mt-20 px-4 py-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold text-center text-primary mb-8">
          Join Multiplayer
        </h1>

        <div className="flex items-center justify-center">
          <div className="flex flex-col items-center gap-6 w-full max-w-md bg-surface text-primary p-8 rounded-3xl shadow-lg">
            <div className="w-full">
              <h2 className="text-2xl mb-2">Username:</h2>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Choose a username"
                className="px-5 py-3 mb-4 rounded bg-background border border-accent-secondary text-primary w-full text-lg"
              />
            </div>
            <div className="w-full">
              <h2 className="text-2xl mb-2">Room Code:</h2>
              <input
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                placeholder="Eg. 23X203"
                className="px-5 py-3 mb-4 rounded bg-background border border-accent-secondary text-primary w-full text-lg"
              />
            </div>
            <div className="flex gap-4 mt-2 w-full">
              <button
                onClick={handleCreateRoom}
                className="flex-1 px-6 py-3 bg-accent-primary text-background rounded hover:opacity-80 text-lg font-medium"
              >
                Create Room
              </button>
              <button
                onClick={handleJoinRoom}
                className="flex-1 px-6 py-3 bg-accent-secondary text-background rounded hover:opacity-80 text-lg font-medium"
              >
                Join Room
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
