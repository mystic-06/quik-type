const express = require("express");
const cors = require("cors");
const { createServer } = require("node:http");
const { Server } = require("socket.io");
const { generate } = require("random-words");

const app = express();

// Configure CORS for Express
app.use(
  cors({
    origin:
      process.env.NODE_ENV === "production"
        ? ["https://your-domain.com"]
        : ["http://localhost:3000"],
    credentials: true,
  })
);

// Basic health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const server = createServer(app);

// Room management structure
class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom(roomId, hostId) {
    const room = {
      id: roomId,
      hostId: hostId,
      phase: "setup",
      config: {
        timerDuration: 30,
        testText: "",
      },
      participants: new Map(),
      testData: null,
      createdAt: Date.now(),
    };

    this.rooms.set(roomId, room);
    console.log(`Room ${roomId} created by ${hostId}`);
    return room;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  deleteRoom(roomId) {
    const deleted = this.rooms.delete(roomId);
    if (deleted) {
      console.log(`Room ${roomId} deleted`);
    }
    return deleted;
  }

  addParticipant(roomId, participant) {
    const room = this.getRoom(roomId);
    if (!room) return null;

    room.participants.set(participant.id, participant);
    console.log(`Participant ${participant.username} added to room ${roomId}`);
    return room;
  }

  removeParticipant(roomId, participantId) {
    const room = this.getRoom(roomId);
    if (!room) return null;

    const participant = room.participants.get(participantId);
    room.participants.delete(participantId);

    // If room is empty, clean it up
    if (room.participants.size === 0) {
      this.deleteRoom(roomId);
      return null;
    }

    // If host left, transfer to next participant
    if (room.hostId === participantId && room.participants.size > 0) {
      const newHost = room.participants.values().next().value;
      room.hostId = newHost.id;
      newHost.isHost = true;
      console.log(`Host transferred to ${newHost.username} in room ${roomId}`);
    }

    if (participant) {
      console.log(
        `Participant ${participant.username} removed from room ${roomId}`
      );
    }

    return room;
  }

  getRoomStats() {
    return {
      totalRooms: this.rooms.size,
      totalParticipants: Array.from(this.rooms.values()).reduce(
        (sum, room) => sum + room.participants.size,
        0
      ),
    };
  }
}

const roomManager = new RoomManager();

// Configure Socket.IO with enhanced CORS and connection handling
const io = new Server(server, {
  cors: {
    origin:
      process.env.NODE_ENV === "production"
        ? ["https://your-domain.com"] // Replace with actual production domain
        : ["http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true,
  },
  connectionStateRecovery: {
    // Enable connection state recovery
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Connection handling
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id} from ${socket.handshake.address}`);

  // Handle join-room event
  socket.on("join-room", (roomId, username) => {
    try {
      console.log(`${username} (${socket.id}) wants to join room ${roomId}`);

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

      console.log(`${username} successfully joined room ${roomId}`);
    } catch (error) {
      console.error("Error in join-room:", error);
      socket.emit("error", "Failed to join room");
    }
  });

  // Handle test configuration
  socket.on("configure-test", (newConfig) => {
    try {
      console.log(`${socket.username} wants to change config:`, newConfig);

      const room = roomManager.getRoom(socket.roomId);
      if (!room) {
        socket.emit("error", "Room not found");
        return;
      }

      if (socket.id !== room.hostId) {
        socket.emit("error", "Only host can configure test");
        return;
      }

      // Validate timer duration
      const validDurations = [15, 30, 60, 120];
      if (!validDurations.includes(newConfig.timerDuration)) {
        socket.emit("error", "Invalid timer duration");
        return;
      }

      room.config.timerDuration = newConfig.timerDuration;

      // Broadcast config update to all participants
      io.to(socket.roomId).emit("config-updated", room.config);
      console.log(`Host updated config in room ${socket.roomId}:`, room.config);
    } catch (error) {
      console.error("Error in configure-test:", error);
      socket.emit("error", "Failed to update configuration");
    }
  });

  // Handle ready toggle
  socket.on("ready-toggle", () => {
    try {
      console.log(`${socket.username} wants to toggle ready state`);

      const room = roomManager.getRoom(socket.roomId);
      if (!room) {
        socket.emit("error", "Room not found");
        return;
      }

      const participant = room.participants.get(socket.id);
      if (!participant) {
        socket.emit("error", "Participant not found in room");
        return;
      }

      // Toggle ready state
      participant.isReady = !participant.isReady;

      // Broadcast ready state change to all participants in the room
      io.to(socket.roomId).emit(
        "ready-state-changed",
        socket.id,
        participant.isReady
      );

      console.log(
        `${socket.username} is now ${
          participant.isReady ? "ready" : "not ready"
        } in room ${socket.roomId}`
      );

      // Check if all participants are ready and start countdown if so
      const allParticipants = Array.from(room.participants.values());
      const allReady = allParticipants.length > 1 && allParticipants.every((p) => p.isReady);

      if (allReady && room.phase === "setup") {
        console.log(
          `All participants ready in room ${socket.roomId}, starting countdown`
        );
        room.phase = "countdown";

        // Start 3-second countdown
        let countdown = 3;
        io.to(socket.roomId).emit("countdown-start", countdown);

        const countdownInterval = setInterval(() => {
          countdown--;
          if (countdown > 0) {
            io.to(socket.roomId).emit("countdown-update", countdown);
          } else {
            clearInterval(countdownInterval);

            // Start the test
            room.phase = "test";
            // Generate random words for the test (same for all players in the room)
            const testWords = generate(200);
            const testText = Array.isArray(testWords) ? testWords.join(" ") : testWords;
            room.config.testText = testText;

            io.to(socket.roomId).emit(
              "test-start",
              testText,
              room.config.timerDuration
            );
            console.log(`Test started in room ${socket.roomId}`);

            // Set timer to end the test
            setTimeout(() => {
              if (room.phase === "test") {
                room.phase = "results";
                io.to(socket.roomId).emit("test-end");
                console.log(`Test ended in room ${socket.roomId}`);
              }
            }, room.config.timerDuration * 1000);
          }
        }, 1000);
      }
    } catch (error) {
      console.error("Error in ready-toggle:", error);
      socket.emit("error", "Failed to toggle ready state");
    }
  });
  // Handle leave room
  socket.on("leave-room", () => {
    handleDisconnection(socket);
  });

  // Handle disconnection
  socket.on("disconnect", (reason) => {
    console.log(`User ${socket.id} disconnected: ${reason}`);
    handleDisconnection(socket);
  });

  // Handle connection errors
  socket.on("error", (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });
});

// Helper function to handle user leaving/disconnecting
function handleDisconnection(socket) {
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
    console.log(`${socket.username || socket.id} left room ${socket.roomId}`);
  } catch (error) {
    console.error("Error handling disconnection:", error);
  }
}

// Periodic cleanup of old empty rooms
setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours

  for (const [roomId, room] of roomManager.rooms.entries()) {
    if (room.participants.size === 0 && now - room.createdAt > maxAge) {
      roomManager.deleteRoom(roomId);
    }
  }
}, 60 * 60 * 1000); // Run every hour

// Log server stats periodically
setInterval(() => {
  const stats = roomManager.getRoomStats();
  console.log(
    `Server stats - Rooms: ${stats.totalRooms}, Participants: ${stats.totalParticipants}`
  );
}, 2 * 60 * 1000); // Every 5 minutes

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});
