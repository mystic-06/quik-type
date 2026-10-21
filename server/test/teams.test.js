const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { startServer, connect, sleep, TEXT } = require("./helpers/harness");
const { installRedisForTests } = require("../lib/redis");

const TOKEN = "organizer-token-for-tests";
let srv;
const clients = [];
let counter = 0;
const newSecret = () => `team-test-secret-${Date.now()}-${++counter}-padding-padding`;

/** A call to the HTTP API as a player (secret) and/or an organizer (admin). */
async function api(method, path, { secret, body, admin = false, raw } = {}) {
  const headers = {};
  if (secret) headers["x-player-secret"] = secret;
  if (admin) headers.Authorization = `Bearer ${TOKEN}`;
  if (body !== undefined || raw !== undefined) headers["Content-Type"] = raw !== undefined ? "text/csv" : "application/json";
  const res = await fetch(`${srv.url}${path}`, { method, headers, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, json, text };
}

/** Opens the room page's socket for a team member. */
async function enter(code, name, secret) {
  const c = await connect(srv.url, { secret });
  clients.push(c);
  c.emit("join-room", code, name);
  await c.waitFor("room-joined");
  return c;
}

/** Two players form a team of two and both open the room. */
async function pair({ size = 2 } = {}) {
  const a = { secret: newSecret() };
  const b = { secret: newSecret() };
  const made = await api("POST", "/teams/create", { secret: a.secret, body: { name: `Team ${++counter}`, size, username: "Ada" } });
  assert.equal(made.status, 201, made.text);
  const code = made.json.code;
  if (size > 1) assert.equal((await api("POST", "/teams/join", { secret: b.secret, body: { code, username: "Bo" } })).status, 200);
  a.client = await enter(code, "Ada", a.secret);
  if (size > 1) b.client = await enter(code, "Bo", b.secret);
  return { a, b, code };
}

/** Everyone readies up, the round starts, and each submits the given number of correct characters just before the deadline. */
async function playRound(players, typed) {
  const started = players.map((p) => p.client.next("test-start"));
  players.forEach((p) => p.client.emit("ready-toggle"));
  await Promise.all(started);
  await sleep(980);
  players.forEach((p, i) => p.client.emit("submit-results", { typed: TEXT.slice(0, typed[i]) }));
}

describe("teams", () => {
  beforeEach(async () => {
    installRedisForTests(null);
    delete process.env.UPSTASH_REDIS_REST_URL;
    process.env.ADMIN_TOKEN = TOKEN;
    srv = await startServer({ settings: { teamRequestsPerMinutePerIp: 1000, minLeaderboardChars: 5 } });
  });
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.close());
    await srv.game.stop();
    delete process.env.ADMIN_TOKEN;
  });

  test("a team forms over HTTP, plays in its room, and its average goes on the team leaderboard", async () => {
    const { a, b, code } = await pair();
    assert.match(code, /^[A-Z]{2}-\d{2}$/);
    const room = a.client.last("room-joined")[0];
    assert.equal(room.kind, "team");
    assert.deepEqual([room.team.name.startsWith("Team"), room.team.targetSize, room.team.full, room.team.code], [true, 2, true, code]);
    assert.equal(room.participants.find((p) => p.isHost).username, "Ada", "the creator is captain");

    a.client.emit("configure-test", { timerDuration: 1 });
    await b.client.waitFor("config-updated");
    await playRound([a, b], [15, 10]);

    const [result] = await a.client.waitFor("team-result");
    assert.equal(result.averageWpm, 50, "(15 + 10 characters) * 4 / 2 members");
    assert.equal(result.counted, true);
    assert.equal(result.members, 2);
    const [standing] = await b.client.waitFor("team-standing");
    assert.equal(standing.rank, 1);

    const board = await (await fetch(`${srv.url}/leaderboard?scope=team&duration=1&me=${code.toLowerCase()}`)).json();
    assert.deepEqual(board.entries.map((e) => [e.id, e.wpm]), [[code, 50]]);
    assert.equal(board.me.rank, 1);
    const players = await (await fetch(`${srv.url}/leaderboard?duration=1`)).json();
    assert.equal(players.entries.length, 2, "members still count on the player board");
  });

  test("a team starts only when it is full and every member is connected and ready; the captain can lock a smaller team", async () => {
    const a = newSecret();
    const made = await api("POST", "/teams/create", { secret: a, body: { name: "Three Of Us", size: 3, username: "Ada" } });
    const code = made.json.code;
    const b = newSecret();
    await api("POST", "/teams/join", { secret: b, body: { code, username: "Bo" } });
    const ca = await enter(code, "Ada", a);
    const cb = await enter(code, "Bo", b);

    ca.emit("ready-toggle");
    cb.emit("ready-toggle");
    await sleep(150);
    assert.equal(ca.all("countdown-start").length, 0, "two of three: no start");

    cb.emit("lock-roster");
    await sleep(60);
    assert.ok(cb.errors().includes("Only the team captain can lock the roster."));

    ca.emit("lock-roster");
    await ca.waitFor("team-updated", (t) => t.targetSize === 2 && t.full);
    await ca.waitFor("countdown-start");
    ca.emit("lock-roster");
    await sleep(60);
    assert.ok(ca.errors().some((e) => /already has 2 players|before a round/.test(e)));
  });

  test("a solo team starts as soon as its one member is ready", async () => {
    const { a } = await pair({ size: 1 });
    a.client.emit("ready-toggle");
    await a.client.waitFor("countdown-start");
  });

  test("the rules: one team per player, unique names, size 1 to 4, a code that exists, a seat that is free", async () => {
    const { a, code } = await pair();
    const dup = await api("POST", "/teams/create", { secret: a.secret, body: { name: "Another", size: 2, username: "Ada" } });
    assert.equal(dup.status, 400);
    assert.match(dup.json.error, /already in team/);

    const name = (await api("GET", "/admin/teams", { admin: true })).json.teams[0].name;
    const other = newSecret();
    assert.match((await api("POST", "/teams/create", { secret: other, body: { name: name.toUpperCase(), size: 2, username: "X" } })).json.error, /already exists/);
    for (const size of [0, 5, 2.5, "x", null]) {
      assert.equal((await api("POST", "/teams/create", { secret: other, body: { name: `Size ${size}`, size, username: "X" } })).status, 400, `size ${size}`);
    }
    assert.equal((await api("POST", "/teams/create", { secret: other, body: { name: "", size: 2, username: "X" } })).status, 400);
    assert.equal((await api("POST", "/teams/create", { secret: other, body: { name: "No Name User", size: 2, username: "" } })).status, 400);

    assert.equal((await api("POST", "/teams/join", { secret: other, body: { code: "ZZ-00", username: "X" } })).status, 400);
    assert.equal((await api("POST", "/teams/join", { secret: other, body: { code: "!!", username: "X" } })).status, 400);
    const third = await api("POST", "/teams/join", { secret: other, body: { code, username: "Cy" } });
    assert.match(third.json.error, /is full/, "both seats taken");
    assert.equal((await api("POST", "/teams/create", { body: { name: "Anon", size: 2, username: "X" } })).status, 400, "no identity, no team");
  });

  test("a team room cannot be entered from outside, and a team in a round cannot be joined", async () => {
    const { a, b, code } = await pair({ size: 3 });
    const outsider = await connect(srv.url);
    clients.push(outsider);
    outsider.emit("join-room", code, "Sneak");
    await outsider.waitFor("error", (m) => /team room/.test(m));

    const c = newSecret();
    await api("POST", "/teams/join", { secret: c, body: { code, username: "Cy" } });
    const cc = await enter(code, "Cy", c);
    a.client.emit("configure-test", { timerDuration: 1 });
    await cc.waitFor("config-updated");
    const finished = a.client.next("final-rankings");
    await playRound([a, b, { client: cc }], [5, 5, 5]);
    await finished;

    // Full now; and even with a seat free, a team that has played cannot be joined in the middle of things
    a.client.emit("restart-room");
    await a.client.next("room-restarted");
    b.client.emit("leave-room");
    await a.client.next("team-updated", (t) => !t.full);
    a.client.emit("ready-toggle");
    cc.emit("ready-toggle");
    await a.client.next("countdown-start").catch(() => {}); // a 2-of-3 team does not start
    const late = newSecret();
    assert.equal((await api("POST", "/teams/join", { secret: late, body: { code, username: "Late" } })).status, 200, "a free seat in setup can be taken");
  });

  test("a team member who disconnects keeps their seat for good; leaving is explicit, and the captain passes on", async () => {
    const { a, b, code } = await pair();
    const bobId = b.client.last("room-joined")[0].you;
    a.client.socket.io.engine.close();
    await b.client.waitFor("participant-status", (_i, connected) => connected === false);
    await sleep(700); // well past the open-room grace period
    assert.equal(srv.game.manager.getRoom(code).players.size, 2, "still a member");

    const back = await enter(code, "Ada", a.secret);
    assert.equal(back.last("room-joined")[0].participants.length, 2);

    // Ada is captain; she leaves the team on purpose
    back.emit("leave-room");
    await b.client.waitFor("host-changed", (id) => id === bobId);
    await b.client.waitFor("team-updated", (t) => !t.full && t.captainId === bobId);
    assert.equal((await api("POST", "/teams/leave", { secret: b.secret })).status, 200);
    assert.equal(srv.game.manager.getRoom(code), undefined, "an empty team is gone");
    // Both are free to start or join another team
    assert.equal((await api("POST", "/teams/create", { secret: a.secret, body: { name: "Fresh Start", size: 1, username: "Ada" } })).status, 201);
  });

  test("a team missing a member's result, or disqualified, never reaches the team leaderboard", async () => {
    const { a, b, code } = await pair();
    const teamBoard = async () => (await (await fetch(`${srv.url}/leaderboard?scope=team&duration=1`)).json()).entries;
    a.client.emit("configure-test", { timerDuration: 1 });
    await b.client.waitFor("config-updated");

    // Bo never submits
    const started = a.client.next("test-start");
    a.client.emit("ready-toggle");
    b.client.emit("ready-toggle");
    await started;
    await sleep(980);
    a.client.emit("submit-results", { typed: TEXT.slice(0, 15) });
    const [result] = await a.client.next("team-result", undefined, 3000);
    assert.equal(result.averageWpm, 30, "a member who did not play counts as zero: (60 + 0) / 2");
    assert.equal(result.counted, false);
    await sleep(100);
    assert.equal((await teamBoard()).length, 0);

    // A proper round counts
    a.client.emit("restart-room");
    await b.client.next("room-restarted");
    const standing = a.client.next("team-standing");
    await playRound([a, b], [15, 15]);
    await standing;
    assert.equal((await teamBoard()).length, 1);

    // An organizer disqualifies the team: it comes off at once, and its later rounds do not count
    assert.equal((await api("POST", `/admin/teams/${code}/disqualify`, { admin: true })).status, 200);
    assert.equal((await teamBoard()).length, 0);
    assert.equal(a.client.last("team-updated")[0].disqualified, true);

    a.client.emit("restart-room");
    await a.client.next("room-restarted");
    const again = a.client.next("team-result");
    await playRound([a, b], [15, 15]);
    assert.equal((await again)[0].counted, false);
    await sleep(100);
    assert.equal((await teamBoard()).length, 0, "and stays off");

    assert.equal((await api("POST", `/admin/teams/${code}/reinstate`, { admin: true })).status, 200);
    assert.equal(a.client.last("team-updated")[0].disqualified, false);
  });

  test("a team's best average is kept, per test length", async () => {
    const { a, b } = await pair();
    a.client.emit("configure-test", { timerDuration: 1 });
    await b.client.waitFor("config-updated");
    const first = a.client.next("team-standing");
    await playRound([a, b], [20, 20]);
    await first;
    a.client.emit("restart-room");
    await b.client.next("room-restarted");
    const second = a.client.next("team-result");
    await playRound([a, b], [5, 5]); // a worse round
    assert.equal((await second)[0].averageWpm, 20);
    await sleep(100);
    const board = await (await fetch(`${srv.url}/leaderboard?scope=team&duration=1`)).json();
    assert.equal(board.entries[0].wpm, 80, "the better round is kept");
  });
});

describe("the team list (roster)", () => {
  const CSV = "team_name,email_1,email_2\nAlpha Squad,ada@example.com,bo@example.com\nSolo Star,cy@example.com,\n";

  beforeEach(async () => {
    installRedisForTests(null);
    delete process.env.UPSTASH_REDIS_REST_URL;
    process.env.ADMIN_TOKEN = TOKEN;
    srv = await startServer({ settings: { teamRequestsPerMinutePerIp: 1000, minLeaderboardChars: 5 } });
  });
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.close());
    await srv.game.stop();
    delete process.env.ADMIN_TOKEN;
  });

  const load = () => api("POST", "/admin/roster", { admin: true, raw: CSV });

  test("organizer routes need the token, and answer as if they did not exist without it", async () => {
    for (const [method, path] of [["GET", "/admin/roster"], ["POST", "/admin/roster"], ["DELETE", "/admin/roster"], ["GET", "/admin/teams"], ["POST", "/admin/teams/AB-12/dissolve"]]) {
      assert.equal((await api(method, path, method === "POST" ? { raw: CSV } : {})).status, 404, `${method} ${path}`);
    }
    delete process.env.ADMIN_TOKEN;
    assert.equal((await api("GET", "/admin/roster", { admin: true })).status, 404, "no token set on the server");
  });

  test("loading a roster: bad files are refused, the list is public without emails, and free team making stops", async () => {
    assert.equal((await api("POST", "/admin/roster", { admin: true, raw: "" })).status, 400);
    assert.equal((await api("POST", "/admin/roster", { admin: true, raw: "just,one,line" })).status, 400);
    assert.equal((await api("POST", "/admin/roster", { admin: true, raw: "a,b\nno,emails" })).status, 400);

    const none = await api("GET", "/teams");
    assert.deepEqual([none.json.rosterActive, none.json.teams], [false, []]);

    const loaded = await load();
    assert.deepEqual(loaded.json, { teams: 2, members: 3 });

    const list = await api("GET", "/teams");
    assert.equal(list.json.rosterActive, true);
    assert.deepEqual(list.json.teams.map((t) => [t.name, t.code, t.targetSize, t.checkedIn, t.status]), [
      ["Alpha Squad", "ALPHASQU", 2, 0, "NOT_STARTED"],
      ["Solo Star", "SOLOSTAR", 1, 0, "NOT_STARTED"],
    ]);
    assert.ok(!list.text.includes("example.com"), "no email is public");
    assert.ok((await api("GET", "/admin/roster", { admin: true })).text.includes("ada@example.com"), "organizers see them");

    const create = await api("POST", "/teams/create", { secret: newSecret(), body: { name: "Freestyle", size: 2, username: "X" } });
    assert.equal(create.status, 403);
    assert.equal((await api("POST", "/teams/join", { secret: newSecret(), body: { code: "ALPHASQU", username: "X" } })).status, 403);
  });

  test("checking in places a player in their team, the leader is captain, and the next member joins it", async () => {
    await load();
    const bo = newSecret();
    const ada = newSecret();

    // Bo arrives first and starts the team; Ada, the registered leader, then becomes captain
    const first = await api("POST", "/teams/checkin", { secret: bo, body: { email: " BO@Example.com " } });
    assert.equal(first.status, 200, first.text);
    assert.deepEqual(first.json, { code: "ALPHASQU", name: "Alpha Squad", targetSize: 2 });
    const cb = await enter("ALPHASQU", "Bo", bo);
    assert.equal(cb.last("room-joined")[0].participants.find((p) => p.isHost).username, "bo");

    const second = await api("POST", "/teams/checkin", { secret: ada, body: { email: "ada@example.com", username: "Ada L" } });
    assert.equal(second.status, 200, second.text);
    const ca = await enter("ALPHASQU", "Ada L", ada);
    const room = ca.last("room-joined")[0];
    assert.equal(room.participants.find((p) => p.isHost).username, "Ada L", "the registered leader is captain");
    assert.equal(room.team.fromRoster, true);

    const list = (await api("GET", "/teams")).json.teams.find((t) => t.code === "ALPHASQU");
    assert.deepEqual([list.checkedIn, list.joined, list.full, list.status], [2, 2, true, "AWAITING_READY"]);

    // Checking in again from the same browser is just a return
    assert.equal((await api("POST", "/teams/checkin", { secret: ada, body: { email: "ada@example.com" } })).status, 200);
    assert.equal((await api("GET", "/teams", { secret: ada })).json.myTeam.code, "ALPHASQU");
  });

  test("an email belongs to the first browser that checks in; an organizer can reset it", async () => {
    await load();
    const owner = newSecret();
    const thief = newSecret();
    assert.equal((await api("POST", "/teams/checkin", { secret: owner, body: { email: "cy@example.com" } })).status, 200);

    const refused = await api("POST", "/teams/checkin", { secret: thief, body: { email: "cy@example.com" } });
    assert.equal(refused.status, 409);
    assert.match(refused.json.error, /another browser/);

    assert.equal((await api("POST", "/admin/roster/reset-member", { admin: true, body: { email: "nobody@example.com" } })).status, 404);
    // Cy is the only member, so the team room exists; free the seat, and remove the owner from it
    assert.equal((await api("POST", "/teams/leave", { secret: owner })).status, 200);
    assert.equal((await api("POST", "/admin/roster/reset-member", { admin: true, body: { email: "cy@example.com" } })).status, 200);
    assert.equal((await api("POST", "/teams/checkin", { secret: thief, body: { email: "cy@example.com" } })).status, 200, "the new browser can have it now");
  });

  test("unknown emails, bad emails, and a browser that already holds another seat are refused cleanly", async () => {
    await load();
    const s = newSecret();
    assert.equal((await api("POST", "/teams/checkin", { secret: s, body: { email: "stranger@example.com" } })).status, 404);
    assert.equal((await api("POST", "/teams/checkin", { secret: s, body: { email: "not-an-email" } })).status, 400);
    assert.equal((await api("POST", "/teams/checkin", { secret: s, body: {} })).status, 400);
    assert.equal((await api("POST", "/teams/checkin", { secret: s, body: { email: "ada@example.com" } })).status, 200);
    const second = await api("POST", "/teams/checkin", { secret: s, body: { email: "cy@example.com" } });
    assert.equal(second.status, 409, "one browser cannot hold two seats");
    // and the failed second check-in did not take Cy's seat
    assert.equal((await api("POST", "/teams/checkin", { secret: newSecret(), body: { email: "cy@example.com" } })).status, 200);
  });

  test("clearing the roster re-opens free team making", async () => {
    await load();
    assert.equal((await api("DELETE", "/admin/roster", { admin: true })).status, 200);
    assert.equal((await api("GET", "/teams")).json.rosterActive, false);
    assert.equal((await api("POST", "/teams/create", { secret: newSecret(), body: { name: "Free Again", size: 1, username: "X" } })).status, 201);
  });

  test("a roster team plays a round like any other", async () => {
    await load();
    const ada = newSecret();
    const bo = newSecret();
    await api("POST", "/teams/checkin", { secret: ada, body: { email: "ada@example.com", username: "Ada" } });
    await api("POST", "/teams/checkin", { secret: bo, body: { email: "bo@example.com", username: "Bo" } });
    const ca = await enter("ALPHASQU", "Ada", ada);
    const cb = await enter("ALPHASQU", "Bo", bo);
    ca.emit("configure-test", { timerDuration: 1 });
    await cb.waitFor("config-updated");
    const resultSoon = ca.next("team-result");
    await playRound([{ client: ca }, { client: cb }], [10, 10]);
    const [result] = await resultSoon;
    assert.deepEqual([result.code, result.averageWpm, result.counted], ["ALPHASQU", 40, true]);
    await ca.waitFor("team-standing");
    const board = await (await fetch(`${srv.url}/leaderboard?scope=team&duration=1`)).json();
    assert.equal(board.entries[0].name, "Alpha Squad");
  });
});

describe("organizer controls on a team", () => {
  beforeEach(async () => {
    installRedisForTests(null);
    delete process.env.UPSTASH_REDIS_REST_URL;
    process.env.ADMIN_TOKEN = TOKEN;
    srv = await startServer({ settings: { teamRequestsPerMinutePerIp: 1000, minLeaderboardChars: 5 } });
  });
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.close());
    await srv.game.stop();
    delete process.env.ADMIN_TOKEN;
  });

  test("excusing a member removes them from the ready gate and the average, and the last active member cannot be excused", async () => {
    const { a, b, code } = await pair();
    const bobId = b.client.last("room-joined")[0].you;
    const adaId = a.client.last("room-joined")[0].you;

    assert.equal((await api("POST", `/admin/teams/${code}/excuse`, { admin: true, body: { id: bobId } })).status, 200);
    await a.client.waitFor("participant-excused", (id, excused) => id === bobId && excused === true);
    b.client.emit("ready-toggle");
    await b.client.waitFor("error", (m) => /excused/.test(m));

    a.client.emit("configure-test", { timerDuration: 1 });
    await a.client.waitFor("config-updated");
    a.client.emit("ready-toggle"); // only Ada must be ready now
    await a.client.waitFor("test-start");
    await sleep(980);
    a.client.emit("submit-results", { typed: TEXT.slice(0, 15) });
    const [result] = await a.client.waitFor("team-result");
    assert.deepEqual([result.averageWpm, result.members, result.counted], [60, 1, true], "Ada alone");
    const [rankings] = await a.client.waitFor("final-rankings");
    assert.deepEqual(rankings.map((r) => r.username), ["Ada"], "the excused member is not ranked");

    const last = await api("POST", `/admin/teams/${code}/excuse`, { admin: true, body: { id: adaId } });
    assert.equal(last.status, 400);
    assert.match(last.json.error, /last active member/);
    assert.equal((await api("POST", `/admin/teams/${code}/excuse`, { admin: true, body: { id: bobId, excused: false } })).status, 200);
    assert.equal((await api("POST", `/admin/teams/${code}/excuse`, { admin: true, body: { id: "pffffffffffff" } })).status, 400);
  });

  test("kicking works only before a round and tells the player; dissolving ends the team for everyone", async () => {
    const { a, b, code } = await pair();
    const bobId = b.client.last("room-joined")[0].you;
    assert.equal((await api("POST", `/admin/teams/${code}/kick`, { admin: true, body: { id: bobId } })).status, 200);
    await b.client.waitFor("removed-from-team");
    await a.client.waitFor("participant-left", (id) => id === bobId);
    assert.equal(srv.game.manager.getRoom(code).players.size, 1);
    // Bo can join another team straight away
    assert.equal((await api("POST", "/teams/create", { secret: b.secret, body: { name: "Bos Own", size: 1, username: "Bo" } })).status, 201);

    assert.equal((await api("POST", `/admin/teams/${code}/dissolve`, { admin: true })).status, 200);
    await a.client.waitFor("team-dissolved");
    assert.equal(srv.game.manager.getRoom(code), undefined);
    assert.equal((await api("POST", `/admin/teams/${code}/dissolve`, { admin: true })).status, 400, "already gone");
    assert.equal((await api("POST", "/teams/create", { secret: a.secret, body: { name: "Phoenix", size: 1, username: "Ada" } })).status, 201, "its members are free");
    assert.equal((await api("POST", `/admin/teams/BAD!/dissolve`, { admin: true })).status, 400);
  });

  test("a member cannot be kicked in the middle of a round", async () => {
    const { a, b, code } = await pair();
    a.client.emit("configure-test", { timerDuration: 2 });
    await a.client.waitFor("config-updated");
    a.client.emit("ready-toggle");
    b.client.emit("ready-toggle");
    await a.client.waitFor("test-start");
    const res = await api("POST", `/admin/teams/${code}/kick`, { admin: true, body: { id: b.client.last("room-joined")[0].you } });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /before a round/);
  });

  test("malformed or oversized bodies get JSON errors, not a crash", async () => {
    const bad = await fetch(`${srv.url}/teams/create`, { method: "POST", headers: { "Content-Type": "application/json", "x-player-secret": newSecret() }, body: "{not json" });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, "Invalid request");
    const big = await fetch(`${srv.url}/teams/create`, { method: "POST", headers: { "Content-Type": "application/json", "x-player-secret": newSecret() }, body: JSON.stringify({ name: "x".repeat(20_000) }) });
    assert.equal(big.status, 413);
    assert.equal((await fetch(`${srv.url}/health`)).status, 200);
  });
});
