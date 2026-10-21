// Redis access (Upstash over HTTPS). Redis is never on the path of a player's action: every call goes through one circuit breaker, and
// while it is open the game carries on from this process's memory.

const { Redis } = require("@upstash/redis");

const CIRCUIT_OPEN_MS = 5000;

let singleton;
let override = null;

class RedisUnavailableError extends Error {
  constructor(reason) {
    super(`Redis unavailable: ${reason}`);
    this.name = "RedisUnavailableError";
  }
}

const keyPrefix = () => process.env.REDIS_KEY_PREFIX?.trim() || "quiktype:v1:";
const key = (...parts) => keyPrefix() + parts.join(":");

/** Redis is used when its credentials are set, unless STATE_BACKEND=memory turns it off. */
function redisConfigured() {
  if (override) return true;
  if (process.env.STATE_BACKEND === "memory") return false;
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function getRedis() {
  if (override) return override;
  if (!redisConfigured()) return null;
  if (singleton === undefined) {
    singleton = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
      // Everything stored here is a string; no surprise conversions of numeric-looking values
      automaticDeserialization: false,
      retry: { retries: 1 },
      // A first request on a cold connection can take a couple of seconds. Nothing on a player's action path waits for Redis.
      signal: () => AbortSignal.timeout(4000),
    });
  }
  return singleton;
}

/** For tests: use this client instead of the configured one. Pass null to go back. */
function installRedisForTests(client) {
  override = client ?? null;
  singleton = undefined;
  guard.reset();
}

class RedisGuard {
  constructor() {
    this.reset();
  }

  reset() {
    this.openUntil = 0;
    this.lastLoggedAt = 0;
    this.lastError = "";
  }

  /** Configured and not currently paused after a failure. */
  isHealthy() {
    return getRedis() !== null && Date.now() >= this.openUntil;
  }

  /** Runs one Redis operation. Throws RedisUnavailableError without touching the network when Redis is off or paused. */
  async run(op, fn) {
    const redis = getRedis();
    if (!redis) throw new RedisUnavailableError("not configured");
    if (Date.now() < this.openUntil) throw new RedisUnavailableError("paused after a failure");
    try {
      return await fn(redis);
    } catch (err) {
      this.openUntil = Date.now() + CIRCUIT_OPEN_MS;
      this.lastError = err instanceof Error ? err.message : String(err);
      const now = Date.now();
      if (now - this.lastLoggedAt > 10_000) {
        this.lastLoggedAt = now;
        console.error(`[Redis] ${op} failed, pausing Redis for ${CIRCUIT_OPEN_MS / 1000}s and carrying on in memory: ${this.lastError}`);
      }
      throw new RedisUnavailableError(this.lastError);
    }
  }
}

const guard = new RedisGuard();

async function pingRedis() {
  try {
    await guard.run("ping", (r) => r.ping());
    return true;
  } catch {
    return false;
  }
}

module.exports = { getRedis, redisConfigured, installRedisForTests, guard, key, pingRedis, RedisUnavailableError };
