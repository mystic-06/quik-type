"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Users, Plus, ArrowRight, User, Hash } from "lucide-react";

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
    <div className="min-h-[75vh] flex items-center justify-center py-12 animate-fade-in-up">
      <div className="w-full max-w-md">
        {/* Heading */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-[var(--secondary)] border-2 border-[var(--border)] rounded-lg shadow-[var(--shadow)] mb-4">
            <Users className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-[var(--ts-2xl)] font-black">Multiplayer</h1>
          <p className="text-[var(--text-secondary)] text-[var(--ts-sm)] mt-1">
            Create a room or join an existing one
          </p>
        </div>

        {/* Form */}
        <div className="nb-card p-8 space-y-6">
          {/* Username */}
          <div>
            <label className="flex items-center gap-2 text-[var(--ts-sm)] font-bold mb-2">
              <User className="w-4 h-4" />
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Choose a username"
              maxLength={20}
              className="nb-input"
            />
          </div>

          {/* Room Code */}
          <div>
            <label className="flex items-center gap-2 text-[var(--ts-sm)] font-bold mb-2">
              <Hash className="w-4 h-4" />
              Room Code
            </label>
            <input
              type="text"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              placeholder="Enter room code to join"
              className="nb-input font-mono uppercase tracking-widest"
            />
          </div>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t-2 border-[var(--border)]" />
            </div>
            <div className="relative flex justify-center">
              <span className="px-3 bg-white text-[var(--ts-xs)] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Choose action
              </span>
            </div>
          </div>

          {/* Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleCreateRoom}
              className="nb-btn nb-btn-primary text-[var(--ts-sm)]"
            >
              <Plus className="w-4 h-4" />
              Create Room
            </button>
            <button
              onClick={handleJoinRoom}
              className="nb-btn nb-btn-secondary text-[var(--ts-sm)]"
            >
              Join Room
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
