// The typing event (sign-in with the club account, timed attempts, admin console) running beside the rooms game in one server.
// The event system is the foss-forge branch's work; these tests cover how it is joined to the rest: who may use its cookie, that it
// is optional, and that the rooms game is unaffected by it.

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { startServer, connect, sleep } = require("./helpers/harness");
const { installRedisForTests } = require("../lib/redis");

const SECRET = "an-oidc-session-secret-of-at-least-32-bytes-long";
const FRONTEND = "https://quik-type.fossclub.tech";
const PREVIEW = "https://quik-type-lookalike.vercel.app"; // allowed for the game, never trusted with the sign-in cookie
const OIDC_ENV = { OIDC_ISSUER: "https://oidc.example.test", OIDC_CLIENT_ID: "client", OIDC_SESSION_SECRET: SECRET, OIDC_ADMIN_SUBJECTS: "admin-sub", FRONTEND_URL: `${FRONTEND},https://quik-type.vercel.app` };

/** A session cookie as the sign-in would have set it. */
function sessionCookie(sub, { admin = false } = {}) {
  const principal = { sub, displayName: sub, pictureUrl: null, isEventAdmin: admin, exp: Math.floor(Date.now() / 1000) + 3600 };
  const body = Buffer.from(JSON.stringify(principal)).toString("base64url");
  const signature = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `quiktype_event_session=${encodeURIComponent(`${body}.${signature}`)}`;
}

class MemoryEventStore {
  constructor() {
    this.state = null;
    this.history = [];
  }
  async initialize() {}
  async load() {
    return this.state;
  }
  async save(payload) {
    this.state = JSON.parse(JSON.stringify(payload));
  }
  async archive(payload) {
    this.history.push(JSON.parse(JSON.stringify(payload)));
  }
  async listHistory() {
    return this.history;
  }
  async getHistory(id) {
    return this.history.find((e) => e.id === id) ?? null;
  }
  async close() {}
}

let srv;
let store;
const clients = [];
const saved = {};

const call = (method, path, { origin, cookie, body } = {}) =>
  fetch(`${srv.url}${path}`, {
    method,
    headers: { ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

describe("the typing event beside the rooms game", () => {
  beforeEach(async () => {
    installRedisForTests(null);
    delete process.env.UPSTASH_REDIS_REST_URL;
    for (const [k, v] of Object.entries(OIDC_ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    store = new MemoryEventStore();
    srv = await startServer({ eventStore: store, env: OIDC_ENV });
  });
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.close());
    await srv.game.stop();
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  });

  const admin = () => sessionCookie("admin-sub", { admin: true });

  test("an organizer creates and opens an event, a participant joins it over the socket and starts an attempt", async () => {
    assert.deepEqual(await (await call("GET", "/event/state")).json(), { event: null });
    const created = await call("POST", "/event/admin/create", { origin: FRONTEND, cookie: admin(), body: { title: "Friday Sprint", durationSeconds: 600 } });
    assert.equal(created.status, 200, await created.text());
    assert.equal((await call("POST", "/event/admin/open", { origin: FRONTEND, cookie: admin() })).status, 200);
    assert.equal((await (await call("GET", "/event/state")).json()).event.status, "open");

    const player = await connect(srv.url, { headers: { Cookie: sessionCookie("student-1"), Origin: FRONTEND } });
    clients.push(player);
    player.emit("event-join");
    const [joined] = await player.waitFor("event-joined");
    assert.equal(joined.event.title, "Friday Sprint");
    player.emit("event-attempt-start");
    const [attempt] = await player.waitFor("event-attempt-started");
    assert.ok(attempt.text.length > 100 || attempt.id, "an attempt began");
  });

  test("the event routes refuse requests with no sign-in, a non-organizer, or a page that is not one of our frontends", async () => {
    const create = (opts) => call("POST", "/event/admin/create", { body: { title: "X", durationSeconds: 600 }, ...opts });
    assert.equal((await create({ origin: FRONTEND })).status, 401, "no cookie");
    assert.equal((await create({ origin: FRONTEND, cookie: sessionCookie("student-1") })).status, 403, "signed in but not an organizer");
    assert.equal((await create({ origin: PREVIEW, cookie: admin() })).status, 403, "a look-alike preview page");
    assert.equal((await create({ cookie: admin() })).status, 403, "no origin at all");
    assert.equal((await call("GET", "/event/history", { origin: FRONTEND })).status, 401);
    assert.equal((await call("GET", "/event/history", { origin: FRONTEND, cookie: admin() })).status, 200);
    const forged = `${admin().slice(0, -3)}abc`;
    assert.equal((await create({ origin: FRONTEND, cookie: forged })).status, 401, "a forged cookie");
  });

  test("the sign-in cookie is only accepted by CORS for the exact frontends; the game's CORS never allows credentials", async () => {
    const trusted = await call("GET", "/event/state", { origin: FRONTEND });
    assert.equal(trusted.headers.get("access-control-allow-origin"), FRONTEND);
    assert.equal(trusted.headers.get("access-control-allow-credentials"), "true");

    const preview = await call("GET", "/event/state", { origin: PREVIEW });
    assert.equal(preview.headers.get("access-control-allow-origin"), null, "a preview page cannot read event responses");

    const preflight = await fetch(`${srv.url}/event/admin/create`, { method: "OPTIONS", headers: { Origin: FRONTEND, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");
    const badPreflight = await fetch(`${srv.url}/event/admin/create`, { method: "OPTIONS", headers: { Origin: PREVIEW, "Access-Control-Request-Method": "POST" } });
    assert.equal(badPreflight.headers.get("access-control-allow-origin"), null);

    // The game routes: readable from a preview page, but never with credentials
    for (const origin of [FRONTEND, PREVIEW]) {
      const res = await call("GET", "/health", { origin });
      assert.equal(res.headers.get("access-control-allow-origin"), origin);
      assert.equal(res.headers.get("access-control-allow-credentials"), null, `/health for ${origin}`);
    }
  });

  test("a preview page can play the rooms game but cannot use the event socket with a stolen cookie", async () => {
    await call("POST", "/event/admin/create", { origin: FRONTEND, cookie: admin(), body: { title: "E", durationSeconds: 600 } });
    await call("POST", "/event/admin/open", { origin: FRONTEND, cookie: admin() });

    const fromPreview = await connect(srv.url, { headers: { Cookie: sessionCookie("student-2"), Origin: PREVIEW } });
    clients.push(fromPreview);
    fromPreview.emit("event-join");
    fromPreview.emit("join-room", "PREV1", "Pat");
    await fromPreview.waitFor("room-joined");
    await sleep(250);
    assert.equal(fromPreview.all("event-joined").length, 0, "the event handlers are not attached for that origin");
    assert.equal(fromPreview.all("event-error").length, 0);
  });

  test("a rooms game and the event run side by side on the same socket", async () => {
    await call("POST", "/event/admin/create", { origin: FRONTEND, cookie: admin(), body: { title: "E", durationSeconds: 600 } });
    await call("POST", "/event/admin/open", { origin: FRONTEND, cookie: admin() });
    const c = await connect(srv.url, { headers: { Cookie: sessionCookie("student-3"), Origin: FRONTEND } });
    clients.push(c);
    c.emit("join-room", "BOTH1", "Dee");
    await c.waitFor("room-joined");
    c.emit("event-join");
    await c.waitFor("event-joined");
    c.emit("ready-toggle");
    await c.waitFor("countdown-start");
  });

  test("the event survives a restart of the server", async () => {
    await call("POST", "/event/admin/create", { origin: FRONTEND, cookie: admin(), body: { title: "Survivor", durationSeconds: 900 } });
    await sleep(300); // saved a moment after it changes
    await srv.game.stop();
    srv = await startServer({ eventStore: store, env: OIDC_ENV });
    assert.equal((await (await call("GET", "/event/state")).json()).event.title, "Survivor");
  });

  test("if the event database is unreachable the rooms game still starts and the event answers 503", async () => {
    await srv.game.stop();
    const broken = new MemoryEventStore();
    broken.initialize = async () => {
      throw new Error("connection refused");
    };
    srv = await startServer({ eventStore: broken, env: OIDC_ENV });
    assert.equal((await call("GET", "/event/state")).status, 503);
    assert.equal((await call("GET", "/health")).status, 200);
    const c = await connect(srv.url);
    clients.push(c);
    c.emit("join-room", "UP1", "Ada");
    await c.waitFor("room-joined");
  });
});

describe("without an event database", () => {
  beforeEach(async () => {
    installRedisForTests(null);
    delete process.env.UPSTASH_REDIS_REST_URL;
    srv = await startServer();
  });
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.close());
    await srv.game.stop();
  });

  test("the rooms game runs and the event routes are not there; sign-in reports it is not configured", async () => {
    assert.equal((await call("GET", "/health")).status, 200);
    assert.equal((await call("GET", "/event/state")).status, 404);
    assert.equal((await call("GET", "/auth/me")).status, 503);
    const c = await connect(srv.url, { headers: { Origin: "http://localhost:3000" } });
    clients.push(c);
    c.emit("event-join"); // nothing is listening, and nothing breaks
    c.emit("join-room", "ALONE1", "Ada");
    await c.waitFor("room-joined");
  });
});
