const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { startServer, connect, sleep, TEXT } = require("./helpers/harness");
const { installRedisForTests } = require("../lib/redis");

let srv;
const clients = [];
const join = async (room, name, opts) => {
  const c = await connect(srv.url, opts);
  clients.push(c);
  c.emit("join-room", room, name);
  await c.waitFor("room-joined");
  return c;
};

/** Everyone ready, then wait for the test to begin. */
async function startRound(players) {
  for (const p of players) p.emit("ready-toggle");
  await Promise.all(players.map((p) => p.waitFor("test-start")));
}
const typeUntilDeadline = (ms = 1000) => sleep(ms - 20);

describe("a round, scored by the server", () => {
  beforeEach(async () => {
    installRedisForTests(null);
    delete process.env.UPSTASH_REDIS_REST_URL;
    srv = await startServer();
  });
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.close());
    await srv.game.stop();
  });

  test("join, ready, countdown, test, results: the server computes every score", async () => {
    const a = await join("ROUND1", "Ada");
    const b = await join("ROUND1", "Bo");
    assert.equal(a.last("room-joined")[0].participants.length, 1);
    assert.equal((await a.waitFor("participant-joined"))[0].username, "Bo");

    a.emit("configure-test", { timerDuration: 1 });
    await b.waitFor("config-updated", (c) => c.timerDuration === 1);

    a.emit("ready-toggle");
    b.emit("ready-toggle");
    await a.waitFor("countdown-start");
    const [text, duration] = await a.waitFor("test-start");
    assert.equal(text, TEXT);
    assert.equal(duration, 1);

    await typeUntilDeadline();
    // Ada types 30 characters, 27 right. Bo types 15, all right. They also claim absurd scores, which are ignored.
    a.emit("submit-results", { typed: TEXT.slice(0, 27) + "zzz", wpm: 299, accuracy: 100 });
    b.emit("submit-results", { typed: TEXT.slice(0, 15) });

    const [rankings] = await a.waitFor("final-rankings");
    assert.deepEqual(rankings.map((r) => [r.username, r.rank, r.wpm, r.accuracy]), [
      // Rounds under 3 seconds are scored as 3 seconds (the same floor the typing screen uses), so these are 27 and 15 characters over 0.05 min
      ["Ada", 1, 108, 90],
      ["Bo", 2, 60, 100],
    ]);
    assert.equal(a.last("room-state-updated")[0].phase, "results");
  });

  test("a finished text is timed by the server, and an early finish is accepted", async () => {
    const a = await join("FAST1", "Solo");
    a.emit("configure-test", { timerDuration: 2 });
    await a.waitFor("config-updated");
    await startRound([a]);
    a.emit("submit-results", { typed: TEXT });
    const [rankings] = await a.waitFor("final-rankings");
    assert.equal(rankings[0].completionPercentage, 100);
    assert.equal(rankings[0].accuracy, 100);
    assert.equal(rankings[0].wpm, Math.round(TEXT.length / 5 / 0.05));
  });

  test("cheating is refused: early submit, a score with no text, extra text, and a second submit", async () => {
    const a = await join("CHEAT1", "Mallory");
    a.emit("configure-test", { timerDuration: 2 });
    await a.waitFor("config-updated");
    await startRound([a]);

    a.emit("submit-results", { typed: TEXT.slice(0, 10) });
    await sleep(60);
    assert.ok(a.errors().includes("The test is still running"), a.errors().join("|"));

    a.emit("submit-results", { wpm: 299, rawWpm: 299, accuracy: 100, charactersTyped: 900, completionPercentage: 100 });
    a.emit("submit-results", { typed: TEXT + " extra" });
    a.emit("submit-results", { typed: { not: "text" } });
    await sleep(60);
    assert.equal(a.errors().filter((e) => e === "Invalid results payload").length, 3);
    assert.equal(a.all("final-rankings").length, 0, "none of those ended the round");

    await sleep(1900);
    a.emit("submit-results", { typed: TEXT.slice(0, 10) });
    a.emit("submit-results", { typed: TEXT.slice(0, 10) });
    await a.waitFor("final-rankings");
    assert.ok(a.errors().some((e) => e === "Results already submitted" || e === "Cannot submit results when test is not active"));
  });

  test("a player who never submits gets a zero when the deadline passes, and the round still ends", async () => {
    const a = await join("NOSHOW", "Present");
    const b = await join("NOSHOW", "Absent");
    a.emit("configure-test", { timerDuration: 1 });
    await a.waitFor("config-updated");
    await startRound([a, b]);
    await typeUntilDeadline();
    a.emit("submit-results", { typed: TEXT.slice(0, 10) });
    const [rankings] = await a.waitFor("final-rankings", () => true, 2000);
    assert.equal(rankings.find((r) => r.username === "Absent").wpm, 0);
    assert.equal(rankings[0].username, "Present");
  });

  test("the host can restart, everyone returns to setup, and the clients are told", async () => {
    const a = await join("AGAIN1", "Host");
    const b = await join("AGAIN1", "Guest");
    a.emit("configure-test", { timerDuration: 1 });
    await a.waitFor("config-updated");
    await startRound([a, b]);
    await typeUntilDeadline();
    a.emit("submit-results", { typed: TEXT.slice(0, 5) });
    b.emit("submit-results", { typed: TEXT.slice(0, 5) });
    await a.waitFor("final-rankings");

    b.emit("restart-room");
    await sleep(60);
    assert.ok(b.errors().includes("Only host can restart room"));

    a.emit("restart-room");
    const [room] = await b.waitFor("room-restarted");
    assert.equal(room.phase, "setup");
    assert.ok(room.participants.every((p) => p.isReady === false));
    assert.equal(srv.game.manager.getRoom("AGAIN1").rankings, null);
  });
});

describe("rooms and players", () => {
  beforeEach(async () => {
    installRedisForTests(null);
    delete process.env.UPSTASH_REDIS_REST_URL;
    srv = await startServer({ settings: { maxPlayersPerRoom: 3, maxRooms: 3 } });
  });
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.close());
    await srv.game.stop();
  });

  test("a dropped connection keeps its seat, ready state and host role, and rejoining takes it back", async () => {
    const a = await join("SEAT1", "Host");
    const b = await join("SEAT1", "Guest");
    a.emit("ready-toggle");
    await b.waitFor("ready-state-changed");

    const hostId = a.last("room-joined")[0].you;
    a.socket.io.engine.close(); // the network drops; the player did not leave
    const [id, connected] = await b.waitFor("participant-status", (_i, c) => c === false);
    assert.equal(id, hostId);
    assert.equal(srv.game.manager.getRoom("SEAT1").players.size, 2, "still seated");

    const back = await join("SEAT1", "Host", { secret: a.secret });
    const room = back.last("room-joined")[0];
    assert.equal(room.you, hostId, "same identity");
    assert.equal(room.participants.length, 2, "no duplicate");
    const me = room.participants.find((p) => p.id === hostId);
    assert.equal(me.isReady, true);
    assert.equal(me.isHost, true);
    assert.equal(me.connected, true);
    await b.waitFor("participant-status", (_i, c) => c === true);
  });

  test("a player who does not come back is removed after the grace period and the host passes on", async () => {
    const a = await join("GRACE1", "Host");
    const b = await join("GRACE1", "Guest");
    const guestId = b.last("room-joined")[0].you;
    a.socket.io.engine.close();
    await b.waitFor("participant-left", undefined, 2000);
    const [newHost] = await b.waitFor("host-changed");
    assert.equal(newHost, guestId);
    assert.equal(srv.game.manager.getRoom("GRACE1").players.size, 1);
  });

  test("leaving on purpose frees the seat at once, and an empty room disappears", async () => {
    const a = await join("LEAVE1", "One");
    a.emit("leave-room");
    await sleep(60);
    assert.equal(srv.game.manager.getRoom("LEAVE1"), undefined);
  });

  test("moving to another room leaves the first one instead of leaving a ghost", async () => {
    const a = await join("ONE", "Mover");
    const b = await join("ONE", "Stay");
    a.emit("join-room", "TWO", "Mover");
    await a.waitFor("room-joined", (r) => r.id === "TWO");
    await b.waitFor("participant-left");
    assert.equal(srv.game.manager.getRoom("ONE").players.size, 1);
    assert.equal(srv.game.manager.getRoom("TWO").players.size, 1);
  });

  test("the same browser in a second tab takes over, and the first tab is told", async () => {
    const first = await join("TABS1", "Dup");
    const second = await join("TABS1", "Dup", { secret: first.secret });
    await first.waitFor("session-replaced");
    assert.equal(srv.game.manager.getRoom("TABS1").players.size, 1);
    assert.equal(second.last("room-joined")[0].participants.length, 1);
  });

  test("names are made unique, and bad input is refused without harming the server", async () => {
    const a = await join("NAMES1", "Sam");
    const b = await join("NAMES1", "Sam");
    assert.deepEqual(b.last("room-joined")[0].participants.map((p) => p.username), ["Sam", "Sam (2)"]);

    const bad = await connect(srv.url);
    clients.push(bad);
    for (const args of [["", "x"], ["../x", "x"], ["OKROOM", ""], ["OKROOM", "x".repeat(21)], [{}, {}], [null, null], ["OKROOM", ["a"]]]) bad.emit("join-room", ...args);
    bad.emit("submit-results", "nonsense");
    bad.emit("configure-test", 42);
    await sleep(100);
    assert.ok(bad.errors().length >= 5);
    assert.equal(srv.game.manager.getRoom("OKROOM"), undefined);
    const ok = await fetch(`${srv.url}/health`);
    assert.equal(ok.status, 200);
  });

  test("a full room, a running round, and too many rooms are all refused", async () => {
    await join("FULL1", "A");
    await join("FULL1", "B");
    await join("FULL1", "C");
    const d = await connect(srv.url);
    clients.push(d);
    d.emit("join-room", "FULL1", "D");
    await d.waitFor("error", (m) => m === "Room is full");

    await join("RM2", "x");
    await join("RM3", "y");
    const e = await connect(srv.url);
    clients.push(e);
    e.emit("join-room", "RM4", "z");
    await e.waitFor("error", (m) => /server is full/.test(m));
  });

  test("a late joiner during a running round is refused, and one during results sees the rankings", async () => {
    const a = await join("LATE1", "A");
    a.emit("configure-test", { timerDuration: 1 });
    await a.waitFor("config-updated");
    await startRound([a]);

    const late = await connect(srv.url);
    clients.push(late);
    late.emit("join-room", "LATE1", "Late");
    await late.waitFor("error", (m) => m === "Cannot join room during active test");

    await typeUntilDeadline();
    a.emit("submit-results", { typed: TEXT.slice(0, 8) });
    await a.waitFor("final-rankings");

    const watcher = await join("LATE1", "Watcher");
    const room = watcher.last("room-joined")[0];
    assert.equal(room.phase, "results");
    assert.ok(!("timer" in room) && !("players" in room) && !("hostKey" in room), "only the public view is sent");
    const [rankings] = await watcher.waitFor("final-rankings");
    assert.equal(rankings[0].username, "A");
  });

  test("a player who drops mid-round and returns before the deadline is caught up on the text", async () => {
    const a = await join("BACK1", "A");
    a.emit("configure-test", { timerDuration: 2 });
    await a.waitFor("config-updated");
    await startRound([a]);
    a.socket.io.engine.close();
    await sleep(100);
    const back = await join("BACK1", "A", { secret: a.secret });
    const [text, remaining] = await back.waitFor("test-start");
    assert.equal(text, TEXT);
    assert.ok(remaining >= 1 && remaining <= 2);
  });

  test("a client that floods an event is slowed down, then disconnected", async () => {
    const a = await join("FLOOD1", "Spam");
    const disconnected = new Promise((resolve) => a.socket.once("disconnect", resolve));
    for (let i = 0; i < 30; i++) a.emit("configure-test", { timerDuration: 99 });
    await a.waitFor("error", (m) => m === "Too many requests. Slow down.");
    for (let i = 0; i < 80; i++) a.emit("configure-test", { timerDuration: 99 });
    await disconnected;
  });
});

describe("http", () => {
  beforeEach(async () => {
    installRedisForTests(null);
    delete process.env.UPSTASH_REDIS_REST_URL;
    srv = await startServer({ settings: { minLeaderboardChars: 5 } });
  });
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.close());
    await srv.game.stop();
    delete process.env.ADMIN_TOKEN;
  });

  test("health reports the state backend", async () => {
    const body = await (await fetch(`${srv.url}/health`)).json();
    assert.equal(body.status, "ok");
    assert.equal(body.state.backend, "memory");
    assert.equal(body.state.redis, "off");
  });

  test("the debug room list is hidden unless an admin token is set and sent", async () => {
    await join("DBG1", "x");
    assert.equal((await fetch(`${srv.url}/debug/rooms`)).status, 404);
    process.env.ADMIN_TOKEN = "s3cret-token";
    assert.equal((await fetch(`${srv.url}/debug/rooms`)).status, 404);
    assert.equal((await fetch(`${srv.url}/debug/rooms`, { headers: { Authorization: "Bearer wrong" } })).status, 404);
    const ok = await fetch(`${srv.url}/debug/rooms`, { headers: { Authorization: "Bearer s3cret-token" } });
    const body = await ok.json();
    assert.equal(body.totalRooms, 1);
    assert.ok(!JSON.stringify(body).includes('"x"'), "no usernames");
  });

  test("cross-origin: an allowed page gets CORS headers, an unknown one does not", async () => {
    const allowed = await fetch(`${srv.url}/health`, { headers: { Origin: "http://localhost:3000" } });
    assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:3000");
    const denied = await fetch(`${srv.url}/health`, { headers: { Origin: "https://evil.example" } });
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
  });

  test("a socket from a refused origin cannot connect", async () => {
    const { io } = require("socket.io-client");
    const refused = io(srv.url, { transports: ["websocket"], reconnection: false, extraHeaders: { Origin: "https://evil.example" } });
    const outcome = await new Promise((resolve) => {
      refused.once("connect", () => resolve("connected"));
      refused.once("connect_error", () => resolve("refused"));
    });
    refused.close();
    assert.equal(outcome, "refused");
  });

  test("leaderboard rejects bad parameters and lists verified results, never claimed ones", async () => {
    assert.equal((await fetch(`${srv.url}/leaderboard?duration=7`)).status, 400);
    assert.equal((await fetch(`${srv.url}/leaderboard?duration=30&period=year`)).status, 400);

    const a = await join("LB1", "Ada");
    a.emit("configure-test", { timerDuration: 1 });
    await a.waitFor("config-updated");
    await startRound([a]);
    await typeUntilDeadline();
    a.emit("submit-results", { typed: TEXT.slice(0, 15), wpm: 299 });
    await a.waitFor("final-rankings");
    await sleep(50);

    const me = a.last("identity")[0].id;
    const board = await (await fetch(`${srv.url}/leaderboard?duration=1&period=all&me=${me}`)).json();
    assert.equal(board.entries.length, 1);
    assert.deepEqual([board.entries[0].name, board.entries[0].wpm, board.entries[0].accuracy], ["Ada", 60, 100]);
    assert.equal(board.me.rank, 1);
    const day = await (await fetch(`${srv.url}/leaderboard?duration=1&period=day`)).json();
    assert.equal(day.entries.length, 1);
    const other = await (await fetch(`${srv.url}/leaderboard?duration=30`)).json();
    assert.equal(other.entries.length, 0);
  });

  test("a result above what a person can type is shown in the room but kept off the leaderboard", async () => {
    const a = await join("LB2", "Bot");
    a.emit("configure-test", { timerDuration: 2 });
    await a.waitFor("config-updated");
    await startRound([a]);
    a.emit("submit-results", { typed: TEXT }); // the whole text, instantly
    const [rankings] = await a.waitFor("final-rankings");
    assert.ok(rankings[0].wpm > 250);
    await sleep(50);
    const board = await (await fetch(`${srv.url}/leaderboard?duration=2&period=all`)).json();
    assert.equal(board.entries.length, 0);
  });
});
