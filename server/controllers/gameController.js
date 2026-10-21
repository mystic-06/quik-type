const { onEvent } = require("../lib/handler");
const { GameError } = require("../lib/errors");

module.exports = ({ socket, manager, limiter }) => {
  const inRoom = () => {
    if (!socket.data.roomId) throw new GameError("Room not found");
    return socket.data.roomId;
  };

  onEvent(socket, limiter, "configure-test", (config) => {
    manager.configure(inRoom(), socket.data.key, config);
  });

  onEvent(socket, limiter, "ready-toggle", () => {
    manager.toggleReady(inRoom(), socket.data.key);
  });

  // The client sends what it typed; the server works out the score
  onEvent(socket, limiter, "submit-results", (payload) => {
    manager.submit(inRoom(), socket.data.key, payload?.typed);
  });
};
