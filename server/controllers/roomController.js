const { onEvent } = require("../lib/handler");
const { GameError } = require("../lib/errors");
const { normalizeRoomId, cleanUsername } = require("../lib/validate");

module.exports = ({ io, socket, manager, limiter }) => {
  // Leaving an open room frees the seat. A team member who only moves to another page keeps their seat (`keepSeat`); leaving the team
  // is the explicit "leave-room" event.
  const leaveCurrentRoom = ({ keepSeat = false } = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.data.roomId = null;
    socket.leave(roomId);
    if (keepSeat && manager.getRoom(roomId)?.kind === "team") manager.socketDisconnected(roomId, socket.data.key, socket.id);
    else manager.removePlayer(roomId, socket.data.key);
  };

  const joinRoom = (rawRoomId, rawUsername) => {
    const roomId = normalizeRoomId(rawRoomId);
    if (!roomId) throw new GameError("Room code must be 3 to 16 letters, numbers, - or _");
    const username = cleanUsername(rawUsername);
    if (!username) throw new GameError("Username must be 1 to 20 characters");

    // A socket sits in one room at a time: moving rooms leaves the old one instead of leaving a ghost behind
    if (socket.data.roomId && socket.data.roomId !== roomId) leaveCurrentRoom({ keepSeat: true });

    const { room, player, displacedSocketId, rejoined } = manager.join({
      roomId,
      key: socket.data.key,
      pubId: socket.data.pubId,
      username,
      socketId: socket.id,
    });

    // The same player in another tab: the newest tab wins and the older one is told why
    if (displacedSocketId) {
      const older = io.sockets.sockets.get(displacedSocketId);
      older?.emit("session-replaced");
      older?.disconnect(true);
    }

    socket.join(roomId);
    socket.data.roomId = roomId;

    socket.emit("room-joined", { ...manager.publicRoom(room), you: player.pubId });
    const view = manager.publicPlayer(room, player);
    socket.to(roomId).emit("participant-joined", view);
    if (rejoined) socket.to(roomId).emit("participant-status", player.pubId, true);

    // A player coming back mid-round is caught up on where the round is
    const now = Date.now();
    if (room.phase === "countdown") {
      socket.emit("countdown-start", Math.max(1, Math.ceil((room.countdownEndsAt - now) / 1000)));
    } else if (room.phase === "test" && !player.finalResults) {
      const remaining = Math.max(1, Math.ceil((room.testEndsAt - now) / 1000));
      socket.emit("test-start", room.testText, remaining, { endsAt: room.testEndsAt, serverNow: now });
    } else if (room.phase === "results" && room.rankings) {
      socket.emit("final-rankings", room.rankings);
    }
  };

  const restartRoom = () => {
    manager.restart(socket.data.roomId, socket.data.key);
  };

  onEvent(socket, limiter, "join-room", joinRoom);
  onEvent(socket, limiter, "restart-room", restartRoom);
  onEvent(socket, limiter, "leave-room", () => leaveCurrentRoom());
  // The captain fixes a team at the players it has, so a team missing someone can still play
  onEvent(socket, limiter, "lock-roster", () => {
    if (!socket.data.roomId) throw new GameError("Room not found");
    manager.lockRoster(socket.data.roomId, socket.data.key);
  });
};
