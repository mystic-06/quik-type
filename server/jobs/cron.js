module.exports = (roomManager) => {
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
  }, 2 * 60 * 1000); // Every 2 minutes
};
