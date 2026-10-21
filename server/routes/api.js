const express = require('express');
const router = express.Router();

module.exports = (roomManager) => {
  // Basic health check endpoint
  router.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Debug endpoint to check room states
  router.get("/debug/rooms", (req, res) => {
    const rooms = Array.from(roomManager.rooms.entries()).map(([id, room]) => ({
      id,
      phase: room.phase,
      participantCount: room.participants.size,
      participants: Array.from(room.participants.values()).map(p => ({
        username: p.username,
        isReady: p.isReady,
        hasResults: !!p.finalResults
      }))
    }));
    res.json({ rooms, totalRooms: rooms.length });
  });

  return router;
};
