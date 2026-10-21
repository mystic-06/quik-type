// An error whose message is safe to show to the player. Anything else is logged and reported generically.
// `status` is the HTTP status when it surfaces through a REST route (sockets just send the message).
class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "GameError";
    this.status = status;
  }
}

module.exports = { GameError };
