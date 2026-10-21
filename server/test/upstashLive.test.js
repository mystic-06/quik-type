// Runs the Redis-backed parts against the real Redis named by UPSTASH_REDIS_REST_URL / _TOKEN, under a key prefix of its own that is removed
// at the end. Skipped unless UPSTASH_LIVE_TEST=1, so the normal test run never touches the network.

const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");

const live = process.env.UPSTASH_LIVE_TEST === "1" && process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;

describe("live Redis", { skip: live ? false : "set UPSTASH_LIVE_TEST=1 with Redis credentials to run" }, () => {
  if (!live) return;
  process.env.REDIS_KEY_PREFIX = `quiktype:livetest:${Date.now()}:`;
  delete process.env.STATE_BACKEND;

  const { getRedis, key, pingRedis, guard } = require("../lib/redis");
  const { startServer, connect, sleep, TEXT } = require("./helpers/harness");
  const { Leaderboard } = require("../services/leaderboard");
  const { RoomMirror, LeaseHeldError } = require("../services/roomMirror");
  const { buildSettings } = require("../config/settings");

  const servers = [];
  const clients = [];
  after(async () => {
    clients.forEach((c) => c.close());
    for (const s of servers) await s.game.stop().catch(() => {});
    const redis = getRedis();
    const keys = await redis.keys(`${process.env.REDIS_KEY_PREFIX}*`);
    if (keys.length) await redis.del(...keys);
  });

  test("reaches Redis under the isolated prefix", async () => {
    assert.equal(await pingRedis(), true);
    assert.ok(key("x").startsWith("quiktype:livetest:"));
  });

  test("leaderboard: best-only, ordering, names, rank, and the daily board, on the real service", async () => {
    const board = new Leaderboard({ settings: buildSettings({ leaderboardCacheMs: 0 }) });
    const entry = (id, wpm, accuracy = 100) => ({ id, name: `Name ${id}`, duration: 30, wpm, accuracy });
    await board.record(entry("pa", 80));
    await board.record(entry("pb", 95, 90));
    await board.record(entry("pc", 95, 99));
    await board.record(entry("pa", 60));
    assert.equal(board.pending.length, 0, "every write reached Redis");

    const fresh = new Leaderboard({ settings: buildSettings({ leaderboardCacheMs: 0 }) }); // reads only what Redis holds
    const { entries, total } = await fresh.top({ duration: 30, period: "all", limit: 10 });
    assert.equal(total, 3);
    assert.deepEqual(entries.map((e) => [e.rank, e.id, e.name, e.wpm, e.accuracy]), [
      [1, "pc", "Name pc", 95, 99],
      [2, "pb", "Name pb", 95, 90],
      [3, "pa", "Name pa", 80, 100],
    ]);
    assert.deepEqual(await fresh.standing({ duration: 30, period: "all", id: "pa" }), { rank: 3, wpm: 80, accuracy: 100 });
    assert.equal(await fresh.standing({ duration: 30, period: "all", id: "ghost" }), null);
    assert.equal((await fresh.top({ duration: 30, period: "day", limit: 10 })).entries.length, 3);
  });

  test("rooms: written, read back after a 'restart', lease enforced", async () => {
    const one = await startServer();
    servers.push(one);
    const a = await connect(one.url);
    clients.push(a);
    a.emit("join-room", "LIVE1", "Ada");
    await a.waitFor("room-joined");
    a.emit("configure-test", { timerDuration: 2 });
    await a.waitFor("config-updated");
    const t0 = performance.now();
    assert.equal(await one.game.mirror().flushNow(), true, one.game.mirror().status.lastError);
    console.log(`  flush of one room: ${Math.round(performance.now() - t0)} ms`);

    const probe = new RoomMirror({ manager: one.game.manager, settings: buildSettings({}) });
    await assert.rejects(() => probe.acquireLease(0), LeaseHeldError);

    const saved = await probe.load();
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, "LIVE1");
    assert.equal(saved[0].config.timerDuration, 2);

    await one.game.stop();
    servers.length = 0;
    const two = await startServer();
    servers.push(two);
    assert.equal(two.game.manager.getRoom("LIVE1")?.players.size, 1, "restored from the real Redis");
    guard.reset();
  });

  test("team leaderboard and roster on the real service: decimals, removal, save and load", async () => {
    const { Roster } = require("../services/roster");
    const settings = buildSettings({ leaderboardCacheMs: 0 });
    const board = new Leaderboard({ settings });
    await board.teams.record({ id: "AA-11", name: "Alpha Squad", duration: 30, wpm: 52.5, accuracy: 98 });
    await board.teams.record({ id: "BB-22", name: "Bravo", duration: 30, wpm: 60, accuracy: 90 });
    assert.equal(board.teams.pending.length, 0, "every write reached Redis");

    const fresh = new Leaderboard({ settings });
    const { entries } = await fresh.teams.top({ duration: 30, period: "all", limit: 5 });
    assert.deepEqual(entries.map((e) => [e.id, e.name, e.wpm, e.accuracy]), [["BB-22", "Bravo", 60, 90], ["AA-11", "Alpha Squad", 52.5, 98]]);
    assert.deepEqual(await fresh.teams.standing({ duration: 30, period: "all", id: "AA-11" }), { rank: 2, wpm: 52.5, accuracy: 98 });
    await board.teams.remove("BB-22");
    assert.deepEqual((await fresh.teams.top({ duration: 30, period: "all", limit: 5 })).entries.map((e) => e.id), ["AA-11"]);

    const roster = new Roster({ settings });
    roster.load("team_name,email_1,email_2\nAlpha Squad,ada@example.com,bo@example.com\n");
    roster.claim("ada@example.com", "key-ada");
    assert.equal(await roster.save(), true);
    const loaded = new Roster({ settings });
    assert.equal(await loaded.loadFromRedis(), 1);
    assert.equal(loaded.find("ada@example.com").member.claimedBy, "key-ada");
    assert.equal(loaded.find("bo@example.com").member.claimedBy, null);
  });

  test("a full round on the real Redis ends up on the leaderboard", async () => {
    const srv = servers[0];
    const a = await connect(srv.url);
    clients.push(a);
    a.emit("join-room", "LIVE2", "Cy");
    await a.waitFor("room-joined");
    a.emit("configure-test", { timerDuration: 1 });
    await a.waitFor("config-updated");
    a.emit("ready-toggle");
    await a.waitFor("test-start");
    await sleep(980);
    a.emit("submit-results", { typed: TEXT.slice(0, 30) });
    await a.waitFor("final-rankings");
    await sleep(500);
    const board = await (await fetch(`${srv.url}/leaderboard?duration=1`)).json();
    assert.equal(board.entries[0].name, "Cy");
    assert.equal(board.entries[0].wpm, 120);
  });
});
