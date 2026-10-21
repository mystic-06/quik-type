const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { FakeRedis } = require("./helpers/fakeRedis");
const { startServer, connect, sleep } = require("./helpers/harness");
const { installRedisForTests, guard, key } = require("../lib/redis");
const { Leaderboard } = require("../services/leaderboard");
const { buildSettings } = require("../config/settings");

const TOKEN = "organizer-token-for-tests";
const CSV = "team_name,email_1,email_2\nAlpha Squad,ada@example.com,bo@example.com\n";
let redis;
const servers = [];
const clients = [];
let counter = 0;
const newSecret = () => `persist-secret-${Date.now()}-${++counter}-padding-padding`;

const boot = async (opts) => {
  const s = await startServer({ settings: { teamRequestsPerMinutePerIp: 1000 }, ...opts });
  servers.push(s);
  return s;
};
const call = (srv, method, path, { secret, body, raw, admin } = {}) =>
  fetch(`${srv.url}${path}`, {
    method,
    headers: {
      ...(secret ? { "x-player-secret": secret } : {}),
      ...(admin ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : raw !== undefined ? { "Content-Type": "text/csv" } : {}),
    },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
function crash(srv) {
  const mirror = srv.game.mirror();
  mirror.disable();
  clearInterval(mirror.leaseTimer);
  srv.game.manager.dispose();
  srv.game.io.close();
}

describe("teams and the roster survive a restart", () => {
  beforeEach(() => {
    redis = new FakeRedis();
    installRedisForTests(redis);
    process.env.ADMIN_TOKEN = TOKEN;
  });
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.close());
    for (const s of servers.splice(0)) await s.game.stop().catch(() => {});
    installRedisForTests(null);
    delete process.env.ADMIN_TOKEN;
  });

  test("the roster, who has checked in, the team room and its members all come back", async () => {
    const one = await boot();
    assert.equal((await call(one, "POST", "/admin/roster", { raw: CSV, admin: true })).status, 201);
    const ada = newSecret();
    assert.equal((await call(one, "POST", "/teams/checkin", { secret: ada, body: { email: "ada@example.com", username: "Ada" } })).status, 200);
    await sleep(60); // the roster is saved a moment after it changes
    await one.game.mirror().flushNow();
    assert.ok(await redis.get(key("roster")), "the roster is in Redis");
    crash(one);

    await sleep(700); // far longer than an open room's grace period: a team member is not removed
    const two = await boot();
    assert.equal(two.game.manager.getRoom("ALPHASQU")?.players.size, 1, "the team and its member are back");
    assert.equal(two.game.manager.getRoom("ALPHASQU").kind, "team");

    const list = await (await call(two, "GET", "/teams")).json();
    assert.equal(list.rosterActive, true);
    assert.deepEqual([list.teams[0].checkedIn, list.teams[0].joined], [1, 1]);

    // Ada's seat is still hers, and only hers
    assert.equal((await call(two, "POST", "/teams/checkin", { secret: newSecret(), body: { email: "ada@example.com" } })).status, 409);
    assert.equal((await call(two, "POST", "/teams/checkin", { secret: ada, body: { email: "ada@example.com" } })).status, 200);
    // and she is still in a team, so she cannot be in another
    assert.equal((await call(two, "GET", "/teams", { secret: ada })).status, 200);
    assert.equal((await (await call(two, "GET", "/teams", { secret: ada })).json()).myTeam.code, "ALPHASQU");

    const c = await connect(two.url, { secret: ada });
    clients.push(c);
    c.emit("join-room", "ALPHASQU", "Ada");
    const [room] = await c.waitFor("room-joined");
    assert.equal(room.team.name, "Alpha Squad");
    assert.equal(room.participants[0].isHost, true);
  });

  test("a roster that an organizer cleared stays cleared after a restart", async () => {
    const one = await boot();
    await call(one, "POST", "/admin/roster", { raw: CSV, admin: true });
    await sleep(60);
    await call(one, "DELETE", "/admin/roster", { admin: true });
    await sleep(60);
    await one.game.stop();
    servers.splice(servers.indexOf(one), 1);
    const two = await boot();
    assert.equal((await (await call(two, "GET", "/teams")).json()).rosterActive, false);
  });

  test("team rooms are kept in Redis much longer than open rooms", async () => {
    const one = await boot();
    await call(one, "POST", "/teams/create", { secret: newSecret(), body: { name: "Keepers", size: 2, username: "K" } });
    const open = await connect(one.url);
    clients.push(open);
    open.emit("join-room", "OPEN1", "Open");
    await open.waitFor("room-joined");
    await one.game.mirror().flushNow();
    const code = [...one.game.manager.rooms.values()].find((r) => r.kind === "team").id;
    const ttl = async (k) => {
      redis.now = () => Date.now() + 8 * 3600_000; // eight hours later
      const present = Boolean(await redis.get(k));
      redis.now = Date.now;
      return present;
    };
    assert.equal(await ttl(key("room", "OPEN1")), false, "an open room expires after hours");
    assert.equal(await ttl(key("room", code)), true, "a team room is still there");
  });
});

describe("team leaderboard", () => {
  let board;
  const settings = buildSettings({ leaderboardCacheMs: 0 });
  beforeEach(() => {
    redis = new FakeRedis();
    installRedisForTests(redis);
    board = new Leaderboard({ settings });
  });
  afterEach(() => installRedisForTests(null));

  const entry = (id, wpm, accuracy = 100) => ({ id, name: `Team ${id}`, duration: 30, wpm, accuracy });

  test("keeps a team's best average with one decimal, orders teams, and reports a rank", async () => {
    await board.teams.record(entry("AA-11", 52.5, 98));
    await board.teams.record(entry("BB-22", 52.5, 99));
    await board.teams.record(entry("CC-33", 60));
    await board.teams.record(entry("AA-11", 40)); // worse: ignored
    const { entries, total } = await board.teams.top({ duration: 30, period: "all", limit: 10 });
    assert.equal(total, 3);
    assert.deepEqual(entries.map((e) => [e.rank, e.id, e.name, e.wpm, e.accuracy]), [
      [1, "CC-33", "Team CC-33", 60, 100],
      [2, "BB-22", "Team BB-22", 52.5, 99],
      [3, "AA-11", "Team AA-11", 52.5, 98],
    ]);
    assert.deepEqual(await board.teams.standing({ duration: 30, period: "all", id: "BB-22" }), { rank: 2, wpm: 52.5, accuracy: 99 });
  });

  test("player and team boards are separate", async () => {
    await board.record({ id: "pa", name: "Player A", duration: 30, wpm: 80, accuracy: 100 });
    await board.teams.record(entry("AA-11", 50));
    assert.deepEqual((await board.top({ duration: 30, period: "all", limit: 5 })).entries.map((e) => e.id), ["pa"]);
    assert.deepEqual((await board.teams.top({ duration: 30, period: "all", limit: 5 })).entries.map((e) => e.id), ["AA-11"]);
  });

  test("removing a team takes it off every board, in Redis and in memory", async () => {
    await board.teams.record(entry("AA-11", 50));
    await board.teams.record({ ...entry("AA-11", 70), duration: 60 });
    await board.teams.record(entry("BB-22", 40));
    await board.teams.remove("AA-11");
    assert.deepEqual((await board.teams.top({ duration: 30, period: "all", limit: 5 })).entries.map((e) => e.id), ["BB-22"]);
    assert.equal((await board.teams.top({ duration: 60, period: "all", limit: 5 })).entries.length, 0);
    assert.equal((await board.teams.top({ duration: 30, period: "day", limit: 5 })).entries.length, 1);
    const fresh = new Leaderboard({ settings });
    assert.deepEqual((await fresh.teams.top({ duration: 30, period: "all", limit: 5 })).entries.map((e) => e.id), ["BB-22"], "gone from Redis as well");
  });

  test("with Redis down team results are shown from memory and written when it returns", async () => {
    redis.failWith = new Error("down");
    await board.teams.record(entry("AA-11", 50));
    assert.equal((await board.teams.top({ duration: 30, period: "all", limit: 5 })).entries[0].name, "Team AA-11");
    redis.failWith = null;
    guard.reset();
    await board.flushPending();
    const fresh = new Leaderboard({ settings });
    assert.equal((await fresh.teams.top({ duration: 30, period: "all", limit: 5 })).entries.length, 1);
  });
});
