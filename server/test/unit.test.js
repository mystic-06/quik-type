const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const { scoreTyping } = require("../lib/scoring");
const { normalizeRoomId, cleanUsername } = require("../lib/validate");
const { buildOriginPolicy } = require("../config/cors");
const { EventLimiter, ConnectionLimiter, RequestLimiter, clientIp } = require("../lib/rateLimit");
const { identityFrom } = require("../app");

describe("scoring", () => {
  const text = "the quick brown fox jumps over the lazy dog";

  test("counts only correct characters toward WPM and reports accuracy", () => {
    // 20 characters typed in 10 seconds, 18 of them right
    const typed = "the quick brown fzz ";
    const r = scoreTyping({ typed, text, elapsedMs: 10_000 });
    assert.equal(r.charactersTyped, 20);
    assert.equal(r.accuracy, 90);
    assert.equal(r.wpm, Math.round(18 / 5 / (10 / 60)));
    assert.equal(r.rawWpm, Math.round(20 / 5 / (10 / 60)));
  });

  test("nothing typed scores zero, and extra characters beyond the text are ignored", () => {
    assert.deepEqual(scoreTyping({ typed: "", text, elapsedMs: 5000 }), { wpm: 0, rawWpm: 0, accuracy: 0, charactersTyped: 0, completionPercentage: 0 });
    assert.equal(scoreTyping({ typed: text + "zzzz", text, elapsedMs: 60_000 }).charactersTyped, text.length);
  });
});

describe("validation", () => {
  test("room codes are normalized and bad ones refused", () => {
    assert.equal(normalizeRoomId(" ab12c "), "AB12C");
    for (const bad of ["", "ab", "a b c", "x".repeat(17), "../etc", null, 42, {}, ["ABC"]]) assert.equal(normalizeRoomId(bad), null, String(bad));
  });

  test("usernames lose invisible characters and must be 1 to 20 characters", () => {
    assert.equal(cleanUsername("  Ada​  Lovelace "), "Ada Lovelace");
    assert.equal(cleanUsername("‮evil"), "evil");
    for (const bad of ["", "   ", "​​", "x".repeat(21), null, 7, {}, ["a"]]) assert.equal(cleanUsername(bad), null, String(bad));
  });
});

describe("origin policy", () => {
  const prod = buildOriginPolicy({ NODE_ENV: "production", FRONTEND_URL: "https://quik-type.vercel.app/, https://game.example.org" });

  test("allows the configured frontends, requests with no origin, and own preview deployments", () => {
    assert.equal(prod.isAllowed("https://quik-type.vercel.app"), true);
    assert.equal(prod.isAllowed("https://game.example.org"), true);
    assert.equal(prod.isAllowed(undefined), true);
    assert.equal(prod.isAllowed("https://quik-type-git-feature-team.vercel.app"), true);
  });

  test("refuses look-alikes: another vercel app, a host that merely contains localhost, plain http", () => {
    assert.equal(prod.isAllowed("https://evil.vercel.app"), false);
    assert.equal(prod.isAllowed("https://evil-localhost.com"), false);
    assert.equal(prod.isAllowed("https://quik-type.vercel.app.evil.com"), false);
    assert.equal(prod.isAllowed("http://quik-type-x.vercel.app"), false);
    assert.equal(prod.isAllowed("not a url"), false);
  });

  test("localhost is allowed in development and refused in production unless asked for", () => {
    assert.equal(prod.isAllowed("http://localhost:3000"), false);
    assert.equal(buildOriginPolicy({ NODE_ENV: "production", ALLOW_LOCALHOST_ORIGINS: "true" }).isAllowed("http://localhost:3000"), true);
    const dev = buildOriginPolicy({ NODE_ENV: "development" });
    assert.equal(dev.isAllowed("http://localhost:3000"), true);
    assert.equal(dev.isAllowed("http://127.0.0.1:5173"), true);
    assert.equal(dev.isAllowed("https://evil.example"), false);
  });
});

describe("limits", () => {
  test("an event bucket allows a burst, refills over time, and eventually asks for a disconnect", () => {
    const limiter = new EventLimiter({ ping: { burst: 3, perSecond: 1 } }, undefined, 5);
    assert.deepEqual([1, 2, 3, 4].map(() => limiter.check("ping", 0)), ["ok", "ok", "ok", "limited"]);
    assert.equal(limiter.check("ping", 1100), "ok");
    const verdicts = [1, 2, 3, 4, 5].map(() => limiter.check("ping", 1100));
    assert.equal(verdicts.at(-1), "kick");
  });

  test("an address may hold only so many connections, and open only so many a minute", () => {
    const limiter = new ConnectionLimiter({ maxConcurrent: 2, perMinute: 3 });
    assert.equal(limiter.admit("a", 0), true);
    assert.equal(limiter.admit("a", 0), true);
    assert.equal(limiter.admit("a", 0), false);
    limiter.release("a");
    assert.equal(limiter.admit("a", 0), true);
    limiter.release("a");
    assert.equal(limiter.admit("a", 0), false, "the per-minute allowance is used up");
    assert.equal(limiter.admit("a", 61_000), true, "a new minute starts fresh");
    assert.equal(limiter.admit("b", 0), true, "other addresses are unaffected");
  });

  test("an HTTP request counter resets each minute", () => {
    const limiter = new RequestLimiter({ perMinute: 2 });
    assert.deepEqual([0, 1, 2].map((i) => limiter.allow("ip", i)), [true, true, false]);
    assert.equal(limiter.allow("ip", 60_000), true);
  });

  test("behind one proxy the client address is the last forwarded entry, and a value the client wrote itself is ignored", () => {
    assert.equal(clientIp({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }, "10.0.0.1", 1), "203.0.113.9");
    assert.equal(clientIp({ "x-forwarded-for": "203.0.113.9" }, "10.0.0.1", 0), "10.0.0.1", "no proxy: the socket address");
    assert.equal(clientIp({}, "10.0.0.1", 1), "10.0.0.1");
  });
});

describe("identity", () => {
  test("the same browser secret gives the same ids, the public id does not reveal the private key, and a missing secret is random", () => {
    const a = identityFrom("a-secret-that-is-long-enough");
    assert.deepEqual(identityFrom("a-secret-that-is-long-enough"), a);
    assert.match(a.pubId, /^p[a-f0-9]{12}$/);
    assert.ok(!a.key.includes(a.pubId.slice(1)));
    assert.notDeepEqual(identityFrom("short"), identityFrom("short"));
  });
});
