const express = require("express");
const cors = require("cors");
const { createServer } = require("node:http");
const { Server } = require("socket.io");

const { corsOptions } = require("./config/cors");
const apiRoutes = require("./routes/api");
const RoomManager = require("./managers/RoomManager");
const startCronJobs = require("./jobs/cron");
const roomController = require("./controllers/roomController");
const gameController = require("./controllers/gameController");
const eventController = require("./controllers/eventController");
const eventApi = require("./routes/eventApi");
const EventStore = require("./managers/EventStore");
const { EventManager } = require("./managers/EventManager");
const { installOidcRoutes } = require("./auth/oidc");

async function startServer() {
  const store = new EventStore();
  await store.initialize();
  const initialState = await store.load();

  const app = express();
  app.use(cors(corsOptions));
  app.use(express.json());
  installOidcRoutes(app);

  const server = createServer(app);
  const roomManager = new RoomManager();
  const eventManager = new EventManager({ store, initialState });

  app.use("/", apiRoutes(roomManager));
  app.use("/", eventApi(eventManager));
  startCronJobs(roomManager);

  const io = new Server(server, {
    cors: corsOptions,
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });
  eventManager.onUpdate = state => io.to("typing-event").emit("event-state-changed", state);

  io.on("connection", socket => {
    roomController(io, socket, roomManager);
    gameController(io, socket, roomManager);
    eventController(io, socket, eventManager);
    socket.on("error", error => console.error(`Socket error for ${socket.id}:`, error));
  });

  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    console.log(`Socket.IO server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  });

  const shutdown = async () => {
    server.close();
    io.close();
    try {
      await eventManager.flushPersistence();
      await store.close();
    }
    catch (error) { console.error("Error closing event database:", error); }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

startServer().catch(error => {
  console.error("Failed to start server:", error);
  process.exitCode = 1;
});
