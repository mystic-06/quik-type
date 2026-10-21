const express = require("express");
const { clientIp } = require("../lib/rateLimit");
const { requireAdmin } = require("../lib/adminAuth");

const PERIODS = new Set(["all", "day"]);
const PLAYER_ID = /^p[a-f0-9]{12}$/;
const TEAM_CODE = /^[A-Z0-9-]{3,10}$/;

module.exports = ({ manager, leaderboard, mirror, settings, requestLimiter, redisStatus }) => {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString(), state: redisStatus(manager.stats()) });
  });

  // Best verified result per player, or per team with ?scope=team (a team's result is the average of its members).
  // ?duration=15|30|60|120  ?period=all|day  ?limit=1..100  ?me=<player id, or team code> adds that one's standing.
  router.get("/leaderboard", async (req, res) => {
    const ip = clientIp(req.headers, req.socket.remoteAddress, settings.trustProxyHops);
    if (!requestLimiter.allow(ip)) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    const duration = Number.parseInt(String(req.query.duration ?? "30"), 10);
    const period = String(req.query.period ?? "all");
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? "50"), 10) || 50, 1), settings.leaderboardSize);
    const scope = req.query.scope === "team" ? "team" : "player";
    const meParam = typeof req.query.me === "string" ? (scope === "team" ? req.query.me.toUpperCase() : req.query.me) : "";
    const me = (scope === "team" ? TEAM_CODE : PLAYER_ID).test(meParam) ? meParam : null;
    if (!settings.validDurations.includes(duration) || !PERIODS.has(period)) {
      res.status(400).json({ error: "Invalid duration or period" });
      return;
    }

    const board = scope === "team" ? leaderboard.teams : leaderboard.players;
    const top = await board.top({ duration, period, limit });
    const standing = me ? await board.standing({ duration, period, id: me }) : null;
    res.json({ scope, duration, period, ...top, me: standing });
  });

  // Which rooms exist: for the person running the server, behind a token. Without ADMIN_TOKEN set the route does not exist.
  router.get("/debug/rooms", requireAdmin, (_req, res) => {
    const rooms = [...manager.rooms.values()].map((room) => ({
      id: room.id,
      kind: room.kind,
      phase: room.phase,
      players: room.players.size,
      connected: [...room.players.values()].filter((p) => p.socketId).length,
    }));
    res.json({ rooms, totalRooms: rooms.length });
  });

  return router;
};
