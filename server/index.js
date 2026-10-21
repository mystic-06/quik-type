const { createGameServer } = require("./app");
const { LeaseHeldError } = require("./services/roomMirror");

const PORT = Number.parseInt(process.env.PORT ?? "", 10) || 3001;
const game = createGameServer();

async function main() {
  try {
    const port = await game.start(PORT);
    console.log(`Socket.IO server running on port ${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  } catch (err) {
    if (err instanceof LeaseHeldError) {
      console.error(
        `FATAL: another QuikType server already holds the room-state lease on this Redis${err.holder ? ` (${err.holder})` : ""}. ` +
          "Two servers must not run the same rooms. Stop the other one, or give this one its own REDIS_KEY_PREFIX."
      );
      process.exit(1);
    }
    throw err;
  }
}

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received. Saving rooms and shutting down...`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  try {
    await game.stop();
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => console.error("Unhandled rejection:", reason));
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  void shutdown("uncaughtException");
});

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
