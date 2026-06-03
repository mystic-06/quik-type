module.exports = (io, socket, roomManager) => {
  const handleDisconnection = () => {
    if (!socket.roomId) return;

    try {
      const room = roomManager.removeParticipant(socket.roomId, socket.id);

      if (room) {
        // Notify remaining participants
        io.to(socket.roomId).emit("participant-left", socket.id);

        // If host left and there's a new host, notify about host change
        const newHost = Array.from(room.participants.values()).find(
          (p) => p.isHost
        );
        if (newHost && newHost.id !== socket.id) {
          io.to(socket.roomId).emit("host-changed", newHost.id);
        }
      }

      socket.leave(socket.roomId);

    } catch (error) {
      console.error("Error handling disconnection:", error);
    }
  };

  const joinRoom = (roomId, username) => {
    try {
      // Validate input
      if (!roomId || !username) {
        socket.emit("error", "Room ID and username are required");
        return;
      }

      if (username.length > 20) {
        socket.emit("error", "Username must be 20 characters or less");
        return;
      }

      let room = roomManager.getRoom(roomId);

      // Create room if it doesn't exist
      if (!room) {
        room = roomManager.createRoom(roomId, socket.id);
      }

      // Check if room is full (max 8 participants)
      if (room.participants.size >= 8) {
        socket.emit("error", "Room is full");
        return;
      }

      // Check if test is in progress
      if (room.phase === "test" || room.phase === "countdown") {
        socket.emit("error", "Cannot join room during active test");
        return;
      }

      const participant = {
        id: socket.id,
        username: username,
        isReady: false,
        isHost: socket.id === room.hostId,
        currentProgress: {
          wpm: 0,
          accuracy: 100,
          charactersTyped: 0,
          completionPercentage: 0,
        },
        finalResults: null,
      };

      roomManager.addParticipant(roomId, participant);
      socket.join(roomId);

      // Store room info on socket
      socket.roomId = roomId;
      socket.username = username;

      // Send room state to joining user
      socket.emit("room-joined", {
        ...room,
        participants: Array.from(room.participants.values()),
      });

      // Notify other participants
      socket.to(roomId).emit("participant-joined", participant);

    } catch (error) {
      console.error("Error in join-room:", error);
      socket.emit("error", "Failed to join room");
    }
  };

  const restartRoom = () => {
    try {
      const room = roomManager.getRoom(socket.roomId);
      if (!room) {
        socket.emit("error", "Room not found");
        return;
      }

      if (socket.id !== room.hostId) {
        socket.emit("error", "Only host can restart room");
        return;
      }

      // Clear any active timers
      roomManager.clearRoomTimers(room);

      // Reset all participants
      const allParticipants = Array.from(room.participants.values());
      allParticipants.forEach(p => {
        p.isReady = false;
        p.finalResults = null;
      });

      // Reset room phase
      room.phase = "setup";

      // Notify all participants about the restart
      io.to(socket.roomId).emit("room-restarted", {
        ...room,
        participants: allParticipants,
      });

    } catch (error) {
      console.error("Error in restart-room:", error);
      socket.emit("error", "Failed to restart room");
    }
  };

  socket.on("join-room", joinRoom);
  socket.on("restart-room", restartRoom);
  socket.on("leave-room", handleDisconnection);
  socket.on("disconnect", (reason) => {
    handleDisconnection();
  });
};
