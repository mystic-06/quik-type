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
      countdownInterval: null,
      testTimeout: null,
      resultsTimeout: null,
    };

    this.rooms.set(roomId, room);

    return room;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  clearRoomTimers(room) {
    if (room.countdownInterval) {
      clearInterval(room.countdownInterval);
      room.countdownInterval = null;
    }
    if (room.testTimeout) {
      clearTimeout(room.testTimeout);
      room.testTimeout = null;
    }
    if (room.resultsTimeout) {
      clearTimeout(room.resultsTimeout);
      room.resultsTimeout = null;
    }
  }

  deleteRoom(roomId) {
    const room = this.getRoom(roomId);
    if (room) {
      this.clearRoomTimers(room);
    }
    const deleted = this.rooms.delete(roomId);
    if (deleted) {
    }
    return deleted;
  }

  addParticipant(roomId, participant) {
    const room = this.getRoom(roomId);
    if (!room) return null;

    room.participants.set(participant.id, participant);

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

    }

    if (participant) {
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

module.exports = RoomManager;
