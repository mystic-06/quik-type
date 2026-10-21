const { io } = require("socket.io-client");
const { createGameServer } = require("../../app");

// Fast timings so a whole round runs in about a second. A test duration of 1 is only valid here.
const FAST = {
  validDurations: [1, 2, 15, 30, 60, 120],
  countdownMs: 120,
  submitGraceMs: 150,
  earlySubmitSlackMs: 40,
  reconnectGraceMs: 400,
  flushDebounceMs: 10,
  leaseTtlMs: 600,
  leaseRenewMs: 200,
  leaderboardCacheMs: 0,
};

const WORDS = Array.from({ length: 60 }, (_, i) => `word${i}`);
const TEXT = WORDS.join(" ");

async function startServer({ settings = {}, env = {}, words = () => WORDS } = {}) {
  const game = createGameServer({ settings: { ...FAST, ...settings }, env: { NODE_ENV: "test", ...env }, words, log: () => {} });
  const port = await game.start(0);
  return { game, port, url: `http://127.0.0.1:${port}` };
}

let counter = 0;
/** A client with its own browser secret. `secret` can be reused to simulate the same browser reconnecting. */
function connect(url, { secret = `secret-${Date.now()}-${++counter}-padding-padding` } = {}) {
  const socket = io(url, { auth: { secret }, transports: ["websocket"], reconnection: false, forceNew: true });
  const seen = [];
  socket.onAny((event, ...args) => seen.push({ event, args }));
  const client = {
    socket,
    secret,
    seen,
    errors: () => seen.filter((e) => e.event === "error").map((e) => e.args[0]),
    last: (event) => [...seen].reverse().find((e) => e.event === event)?.args,
    all: (event) => seen.filter((e) => e.event === event).map((e) => e.args),
    emit: (...args) => socket.emit(...args),
    waitFor: (event, predicate = () => true, ms = 3000) =>
      new Promise((resolve, reject) => {
        const existing = seen.find((e) => e.event === event && predicate(...e.args));
        if (existing) return resolve(existing.args);
        const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}" (saw: ${seen.map((e) => e.event).join(", ")})`)), ms);
        const handler = (...args) => {
          if (!predicate(...args)) return;
          clearTimeout(timer);
          socket.off(event, handler);
          resolve(args);
        };
        socket.on(event, handler);
      }),
    /** Waits for the next such event, ignoring any that came before this call. */
    next: (event, predicate = () => true, ms = 3000) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for a new "${event}"`)), ms);
        const handler = (...args) => {
          if (!predicate(...args)) return;
          clearTimeout(timer);
          socket.off(event, handler);
          resolve(args);
        };
        socket.on(event, handler);
      }),
    close: () => socket.disconnect(),
  };
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(client));
    socket.once("connect_error", reject);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { startServer, connect, sleep, FAST, WORDS, TEXT };
