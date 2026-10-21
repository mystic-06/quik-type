const http = require("node:http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");

const { buildSettings } = require("./config/settings");
const { buildOriginPolicy } = require("./config/cors");
const { getRedis, redisConfigured, pingRedis, guard } = require("./lib/redis");
const { identityFrom } = require("./lib/identity");
const { EventLimiter, ConnectionLimiter, RequestLimiter, clientIp } = require("./lib/rateLimit");
const RoomManager = require("./managers/RoomManager");
const { RoomMirror } = require("./services/roomMirror");
const { Leaderboard } = require("./services/leaderboard");
const { Roster } = require("./services/roster");
const apiRoutes = require("./routes/api");
const teamRoutes = require("./routes/teams");
const adminRoutes = require("./routes/admin");
const startCronJobs = require("./jobs/cron");
const roomController = require("./controllers/roomController");
const gameController = require("./controllers/gameController");

// Per-socket limits on each event: a burst, then a steady rate
const EVENT_RULES = {
  "join-room": { burst: 5, perSecond: 0.5 },
  "leave-room": { burst: 5, perSecond: 0.5 },
  "ready-toggle": { burst: 6, perSecond: 1 },
  "configure-test": { burst: 10, perSecond: 2 },
  "restart-room": { burst: 3, perSecond: 0.2 },
  "submit-results": { burst: 6, perSecond: 0.5 },
  "lock-roster": { burst: 3, perSecond: 0.2 },
};

/**
 * Builds the whole server without starting it, so tests can run it on any port with short timings.
 * `start()` restores saved rooms (when Redis is configured) and begins listening; `stop()` saves and shuts down cleanly.
 */
function createGameServer({ settings: overrides = {}, words, env = process.env, log = console.log } = {}) {
  const settings = buildSettings(overrides);
  const policy = buildOriginPolicy(env);

  const app = express();
  app.disable("x-powered-by");
  app.use(cors(policy.corsOptions));

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: policy.corsOptions,
    // Browsers do not apply CORS to a WebSocket upgrade, so the origin is checked here as well
    allowRequest: (req, callback) => callback(null, policy.isAllowed(req.headers.origin)),
    // The largest legitimate message is the typed text of one round (about 1.5 KB)
    maxHttpBufferSize: 16 * 1024,
    // A dead connection is noticed within about 30 seconds, inside the reconnect grace period
    pingInterval: 15_000,
    pingTimeout: 15_000,
  });

  const leaderboard = new Leaderboard({ settings });
  const roster = new Roster({ settings });
  let mirror = null;

  const manager = new RoomManager({
    settings,
    words,
    emit: (roomId, event, ...args) => io.to(roomId).emit(event, ...args),
    onChange: (room) => mirror?.markDirty(room.id),
    onRemove: (roomId) => mirror?.markRemoved(roomId),
    // Takes a socket out of a room (kicked, or its team was dissolved)
    evict: (roomId, socketId, message) => {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) return;
      if (message) socket.emit("removed-from-team", message);
      socket.leave(roomId);
      socket.data.roomId = null;
    },
    onFinished: ({ room, duration, results, team }) => {
      for (const result of results) {
        if (!result.verified || result.wpm <= 0 || result.charactersTyped < settings.minLeaderboardChars) continue;
        if (result.wpm > settings.maxVerifiedWpm) {
          log(`Result of ${result.wpm} WPM left off the leaderboard (above ${settings.maxVerifiedWpm}).`);
          continue;
        }
        void leaderboard.record({ id: result.id, name: result.name, duration, wpm: result.wpm, accuracy: result.accuracy });
      }

      // A team's result (the average of its members) goes on the team leaderboard, and the team is told where it stands
      if (team?.eligible) {
        const entry = { id: team.code, name: team.name, duration, wpm: team.averageWpm, accuracy: team.averageAccuracy };
        leaderboard.teams
          .record(entry)
          .then(() => leaderboard.teams.standing({ duration, period: "all", id: team.code }))
          .then((standing) => {
            if (standing) io.to(room.id).emit("team-standing", { rank: standing.rank, bestWpm: standing.wpm, duration });
          })
          .catch(() => {});
      }
    },
  });

  const connections = new ConnectionLimiter({
    maxConcurrent: settings.maxConnectionsPerIp,
    perMinute: settings.connectionsPerMinutePerIp,
  });
  const requestLimiter = new RequestLimiter({ perMinute: settings.httpRequestsPerMinutePerIp });
  const teamLimiter = new RequestLimiter({ perMinute: settings.teamRequestsPerMinutePerIp });

  const redisStatus = (stats) => ({
    backend: redisConfigured() ? "upstash" : "memory",
    redis: !redisConfigured() ? "off" : guard.isHealthy() ? "ok" : "down",
    saving: mirror ? mirror.status.enabled && mirror.status.holdsLease && mirror.status.lastError === "" : false,
    ...stats,
  });

  app.use("/", apiRoutes({ manager, leaderboard, mirror: () => mirror, settings, requestLimiter, redisStatus }));
  app.use("/", teamRoutes({ manager, roster, settings, teamLimiter }));
  app.use("/", adminRoutes({ manager, roster, leaderboard, settings }));

  // A request body that is too large or not valid JSON gets a JSON answer, not an HTML error page
  app.use((err, _req, res, _next) => {
    const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) console.error("Request failed:", err);
    res.status(status).json({ error: status === 500 ? "Something went wrong" : "Invalid request" });
  });

  io.use((socket, next) => {
    const ip = clientIp(socket.handshake.headers, socket.handshake.address, settings.trustProxyHops);
    if (!connections.admit(ip)) {
      next(new Error("Too many connections"));
      return;
    }
    socket.data.ip = ip;
    Object.assign(socket.data, identityFrom(socket.handshake.auth?.secret), { roomId: null });
    next();
  });

  io.on("connection", (socket) => {
    const limiter = new EventLimiter(EVENT_RULES);
    const ctx = { io, socket, manager, limiter };
    roomController(ctx);
    gameController(ctx);

    socket.emit("identity", { id: socket.data.pubId });

    socket.on("disconnect", () => {
      connections.release(socket.data.ip);
      if (socket.data.roomId) manager.socketDisconnected(socket.data.roomId, socket.data.key, socket.id);
    });
    socket.on("error", (error) => console.error(`Socket error for ${socket.id}:`, error));
  });

  let stopCron = () => {};

  async function start(port) {
    if (getRedis()) {
      mirror = new RoomMirror({ manager, settings });
      // A cold first request can fail once. Starting without the saved rooms would lose them, so try a few times before giving up.
      let reachable = false;
      for (let attempt = 1; attempt <= 3 && !reachable; attempt++) {
        reachable = await pingRedis();
        if (!reachable && attempt < 3) {
          guard.reset();
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      if (reachable) {
        // Throws LeaseHeldError if another server is running this game
        await mirror.acquireLease();
        const restored = manager.restore(await mirror.load());
        const teams = await roster.loadFromRedis();
        log(`Restored ${restored} room(s) and a roster of ${teams} team(s) from Redis.`);
      } else {
        console.error("[Rooms] Redis is not reachable. Starting empty; saving will begin by itself if it comes back.");
      }
      mirror.enable();
    }

    stopCron = startCronJobs({ manager, leaderboard, settings, limiters: [connections, requestLimiter, teamLimiter], log });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, () => {
        server.off("error", reject);
        resolve();
      });
    });
    return server.address().port;
  }

  async function stop() {
    stopCron();
    io.emit("server-restarting");
    guard.reset(); // one real attempt to save, even if a recent blip paused Redis
    await roster.flush();
    await Promise.race([leaderboard.flushPending(), new Promise((resolve) => setTimeout(resolve, 2000))]);
    if (mirror) await mirror.shutdown();
    manager.dispose();
    await new Promise((resolve) => {
      io.close(() => resolve());
      setTimeout(resolve, 3000).unref?.();
    });
  }

  return { app, server, io, manager, leaderboard, roster, settings, mirror: () => mirror, start, stop };
}

module.exports = { createGameServer, identityFrom };
