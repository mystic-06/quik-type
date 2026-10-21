const { GameError } = require("./errors");

/**
 * Registers a socket event handler behind the per-socket rate limit. A player-facing mistake (GameError) is reported to that player;
 * anything else is logged and reported generically, so one bad message never takes the server down or leaks internals.
 */
function onEvent(socket, limiter, event, handler) {
  socket.on(event, (...args) => {
    const verdict = limiter.check(event);
    if (verdict === "kick") {
      socket.disconnect(true);
      return;
    }
    if (verdict === "limited") {
      socket.emit("error", "Too many requests. Slow down.");
      return;
    }
    try {
      handler(...args);
    } catch (err) {
      if (err instanceof GameError) {
        socket.emit("error", err.message);
      } else {
        console.error(`Error in ${event}:`, err);
        socket.emit("error", "Something went wrong");
      }
    }
  });
}

module.exports = { onEvent };
