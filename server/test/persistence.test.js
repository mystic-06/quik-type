const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { FakeRedis } = require("./helpers/fakeRedis");
const { startServer, connect, sleep, TEXT } = require("./helpers/harness");
const { installRedisForTests, guard, key } = require("../lib/redis");
const { LeaseHeldError } = require("../services/roomMirror");
const { Leaderboard } = require("../services/leaderboard");
const { buildSettings } = require("../config/settings");

let redis;
const servers = [];
const clients = [];

const boot = async (opts) => {
  const s = await startServer(opts);
  servers.push(s);
  return s;
};
const join = async (srv, room, name, opts) => {
  const c = await connect(srv.url, opts);
  clients.push(c);
  c.emit("join-room", room, name);
  await c.waitFor("room-joined");
  return c;
};

/** A process that dies: nothing is saved or released on the way out. */
function crash(srv) {
  const mirror = srv.game.mirror();
  mirror.disable();
  clearInterval(mirror.leaseTimer);
  srv.game.manager.dispose();
  srv.game.io.close();
}

describe("rooms survive a restart", () => {
  beforeEach(() => {
    redis = new FakeRedis();
    installRedisForTests(redis);
  });
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.close());
    for (const s of servers.splice(0)) await s.game.stop().catch(() => {});
    installRedisForTests(null);
  });

  test("a crash in the middle of a round: players reconnect, get the same text and the time left, and finish normally", async () => {
    const one = await boot();
    const a = await join(one, "CRASH1", "Ada");
    const b = await join(one, "CRASH1", "Bo");
    a.emit("configure-test", { timerDuration: 2 });
    await b.waitFor("config-updated");
    a.emit("ready-toggle");
    b.emit("ready-toggle");
    await a.waitFor("test-start");
    const ada = a.last("room-joined")[0].you;
    await one.game.mirror().flushNow();

    crash(one);
    a.close();
    b.close();

    const two = await boot();
    assert.equal(two.game.manager.getRoom("CRASH1")?.phase, "test", "the round was restored");

    const a2 = await join(two, "CRASH1", "Ada", { secret: a.secret });
    const b2 = await join(two, "CRASH1", "Bo", { secret: b.secret });
    assert.equal(a2.last("room-joined")[0].you, ada, "the same player");
    const [text, remaining] = await a2.waitFor("test-start");
    assert.equal(text, TEXT);
    assert.ok(remaining >= 1 && remaining <= 2);

    await sleep(1900);
    a2.emit("submit-results", { typed: TEXT.slice(0, 20) });
    b2.emit("submit-results", { typed: TEXT.slice(0, 10) });
    const [rankings] = await a2.waitFor("final-rankings");
    assert.deepEqual(rankings.map((r) => r.username), ["Ada", "Bo"]);
  });

  test("a round whose deadline passed while the server was down is closed as soon as it is back", async () => {
    const one = await boot();
    const a = await join(one, "LATE2", "Ada");
    a.emit("configure-test", { timerDuration: 1 });
    await a.waitFor("config-updated");
    a.emit("ready-toggle");
    await a.waitFor("test-start");
    await one.game.mirror().flushNow();
    crash(one);
    a.close();

    await sleep(1400); // longer than the test plus the submit allowance
    const two = await boot();
    await sleep(50);
    assert.equal(two.game.manager.getRoom("LATE2").phase, "results");
    const a2 = await join(two, "LATE2", "Ada", { secret: a.secret });
    const [rankings] = await a2.waitFor("final-rankings");
    assert.equal(rankings[0].wpm, 0, "nothing was submitted");
  });

  test("a clean shutdown saves everything and hands the lease over at once", async () => {
    const one = await boot();
    const a = await join(one, "CLEAN1", "Ada");
    a.emit("ready-toggle");
    await a.waitFor("countdown-start");
    await one.game.stop();
    servers.splice(servers.indexOf(one), 1);
    assert.equal(await redis.get(key("lease")), null, "lease released");

    const started = Date.now();
    const two = await boot();
    assert.ok(Date.now() - started < 400, "no waiting for a lease to run out");
    assert.equal(two.game.manager.getRoom("CLEAN1")?.players.size, 1);
  });

  test("players who never come back are gone after the grace period, and so is the room", async () => {
    const one = await boot();
    const a = await join(one, "GONE1", "Ada");
    await one.game.mirror().flushNow();
    crash(one);
    a.close();

    const two = await boot();
    assert.equal(two.game.manager.getRoom("GONE1").players.size, 1);
    await sleep(600);
    assert.equal(two.game.manager.getRoom("GONE1"), undefined);
    await two.game.mirror().flushNow();
    assert.equal(await redis.get(key("room", "GONE1")), null, "removed from Redis too");
  });

  test("rooms that expired in Redis are not brought back", async () => {
    const one = await boot();
    await join(one, "OLD1", "Ada");
    await one.game.mirror().flushNow();
    crash(one);
    redis.now = (() => { const t = Date.now(); return () => t + 7 * 3600_000; })();
    const two = await boot();
    assert.equal(two.game.manager.getRoom("OLD1"), undefined);
  });

  test("a second server cannot run the same rooms while the first holds the lease", async () => {
    await boot();
    await assert.rejects(() => startServer(), LeaseHeldError);
  });

  test("a Redis outage never reaches the players, and the copy catches up afterwards", async () => {
    const one = await boot();
    redis.failWith = new Error("connection reset");
    const a = await join(one, "OUT1", "Ada"); // the game goes on
    a.emit("ready-toggle");
    await a.waitFor("countdown-start");
    await one.game.mirror().flushNow();
    assert.match(one.game.mirror().status.lastError, /connection reset|paused/);
    const health = await (await fetch(`${one.url}/health`)).json();
    assert.equal(health.state.redis, "down");
    assert.equal(health.state.saving, false);

    redis.failWith = null;
    guard.reset();
    assert.equal(await one.game.mirror().flushNow(), true);
    assert.ok(await redis.get(key("room", "OUT1")), "the room reached Redis");
    assert.equal((await (await fetch(`${one.url}/health`)).json()).state.saving, true);
  });

  test("a clean shutdown saves even when a recent failure has paused Redis, so the newest changes are not lost", async () => {
    const one = await boot();
    const a = await join(one, "PAUSE1", "Ada");
    await one.game.mirror().flushNow();

    // A blip opens the breaker; Redis is back straight away but the breaker is still paused
    redis.failWith = new Error("timeout");
    a.emit("configure-test", { timerDuration: 15 });
    await a.waitFor("config-updated", (c) => c.timerDuration === 15);
    await one.game.mirror().flushNow(); // fails, and pauses Redis
    redis.failWith = null;
    a.emit("configure-test", { timerDuration: 2 });
    await a.waitFor("config-updated", (c) => c.timerDuration === 2);
    assert.equal(guard.isHealthy(), false, "the breaker is paused");

    await one.game.stop();
    servers.splice(servers.indexOf(one), 1);
    const saved = JSON.parse(await redis.get(key("room", "PAUSE1")));
    assert.equal(saved.config.timerDuration, 2, "the change made during the pause was saved on the way out");
  });

  test("starting while Redis is unreachable still works, and saving begins when it returns", async () => {
    redis.failWith = new Error("unreachable");
    const one = await boot();
    const a = await join(one, "BOOT1", "Ada");
    assert.ok(a.last("room-joined"));
    redis.failWith = null;
    guard.reset();
    assert.equal(await one.game.mirror().flushNow(), true);
    assert.ok(await redis.get(key("room", "BOOT1")));
  });

  test("secrets are never stored: Redis holds hashes of identity, not the browser secret", async () => {
    const one = await boot();
    const a = await join(one, "SAFE1", "Ada");
    await one.game.mirror().flushNow();
    const saved = await redis.get(key("room", "SAFE1"));
    assert.ok(!saved.includes(a.secret));
    assert.ok(!(await one.game.mirror().load()).some((r) => JSON.stringify(r).includes(a.secret)));
  });
});

describe("leaderboard in Redis", () => {
  let board;
  const settings = buildSettings({ leaderboardCacheMs: 0 });
  const entry = (id, wpm, accuracy = 100, extra = {}) => ({ id, name: id.toUpperCase(), duration: 30, wpm, accuracy, ...extra });

  beforeEach(() => {
    redis = new FakeRedis();
    installRedisForTests(redis);
    board = new Leaderboard({ settings });
  });
  afterEach(() => installRedisForTests(null));

  test("keeps each player's best, orders by WPM then accuracy, and reports a player's rank", async () => {
    await board.record(entry("pa", 80));
    await board.record(entry("pb", 95, 90));
    await board.record(entry("pc", 95, 99));
    await board.record(entry("pa", 60)); // worse: ignored
    await board.record(entry("pb", 70)); // worse: ignored

    const { entries, total } = await board.top({ duration: 30, period: "all", limit: 10 });
    assert.equal(total, 3);
    assert.deepEqual(entries.map((e) => [e.rank, e.id, e.name, e.wpm, e.accuracy]), [
      [1, "pc", "PC", 95, 99],
      [2, "pb", "PB", 95, 90],
      [3, "pa", "PA", 80, 100],
    ]);
    assert.deepEqual(await board.standing({ duration: 30, period: "all", id: "pb" }), { rank: 2, wpm: 95, accuracy: 90 });
    assert.equal(await board.standing({ duration: 30, period: "all", id: "nobody" }), null);
  });

  test("boards are separate per test length, and the daily board forgets yesterday", async () => {
    let now = Date.UTC(2026, 5, 1, 12);
    board = new Leaderboard({ settings, clock: () => now });
    await board.record(entry("pa", 80));
    await board.record(entry("pb", 50, 100, { duration: 60 }));
    assert.equal((await board.top({ duration: 30, period: "all", limit: 5 })).entries.length, 1);
    assert.equal((await board.top({ duration: 60, period: "all", limit: 5 })).entries[0].id, "pb");
    assert.equal((await board.top({ duration: 30, period: "day", limit: 5 })).entries.length, 1);
    now += 24 * 3600_000;
    assert.equal((await board.top({ duration: 30, period: "day", limit: 5 })).entries.length, 0, "a new day starts empty");
    assert.equal((await board.top({ duration: 30, period: "all", limit: 5 })).entries.length, 1);
  });

  test("a restart does not lose the board", async () => {
    await board.record(entry("pa", 80));
    const fresh = new Leaderboard({ settings });
    assert.equal((await fresh.top({ duration: 30, period: "all", limit: 5 })).entries[0].name, "PA");
  });

  test("with Redis down results are kept in memory, shown, and written when Redis returns", async () => {
    redis.failWith = new Error("down");
    await board.record(entry("pa", 80));
    await board.record(entry("pb", 90));
    const during = await board.top({ duration: 30, period: "all", limit: 5 });
    assert.deepEqual(during.entries.map((e) => e.id), ["pb", "pa"]);
    assert.equal((await board.standing({ duration: 30, period: "all", id: "pa" })).rank, 2);

    redis.failWith = null;
    guard.reset();
    await board.flushPending();
    assert.equal(board.pending.length, 0);
    const fresh = new Leaderboard({ settings });
    assert.deepEqual((await fresh.top({ duration: 30, period: "all", limit: 5 })).entries.map((e) => e.id), ["pb", "pa"]);
  });

  test("reads are cached briefly so a busy page does not hammer Redis", async () => {
    board = new Leaderboard({ settings: buildSettings({ leaderboardCacheMs: 5000 }) });
    await board.record(entry("pa", 80));
    await board.top({ duration: 30, period: "all", limit: 5 });
    const before = redis.count("zrange");
    for (let i = 0; i < 20; i++) await board.top({ duration: 30, period: "all", limit: 5 });
    assert.equal(redis.count("zrange"), before);
  });
});
