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

const app = express();

// Configure CORS for Express
app.use(cors(corsOptions));

const server = createServer(app);

// Instantiate state manager
const roomManager = new RoomManager();

// Apply REST API routes
app.use("/", apiRoutes(roomManager));

// Start background tasks
startCronJobs(roomManager);

// Configure Socket.IO with enhanced CORS and connection handling
const io = new Server(server, {
  cors: corsOptions,
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
  // Register controllers
  roomController(io, socket, roomManager);
  gameController(io, socket, roomManager);

  // Connection errors
  socket.on("error", (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});
