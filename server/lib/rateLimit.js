// Abuse limits kept in this process's memory. They guard one server, so Redis would only add latency.

/**
 * Per-socket token buckets, one per event name. `rules[event] = { burst, perSecond }`.
 * Repeated violations return "kick" so a flooding client is disconnected instead of answered forever.
 */
class EventLimiter {
  constructor(rules, fallback = { burst: 20, perSecond: 5 }, kickAfter = 40) {
    this.rules = rules;
    this.fallback = fallback;
    this.kickAfter = kickAfter;
    this.buckets = new Map();
    this.violations = 0;
  }

  /** @returns {"ok" | "limited" | "kick"} */
  check(event, now = Date.now()) {
    const rule = this.rules[event] ?? this.fallback;
    let bucket = this.buckets.get(event);
    if (!bucket) {
      bucket = { tokens: rule.burst, at: now };
      this.buckets.set(event, bucket);
    }
    bucket.tokens = Math.min(rule.burst, bucket.tokens + ((now - bucket.at) / 1000) * rule.perSecond);
    bucket.at = now;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return "ok";
    }
    this.violations += 1;
    return this.violations >= this.kickAfter ? "kick" : "limited";
  }
}

/** Limits how many connections an address may hold and how fast it may open them. */
class ConnectionLimiter {
  constructor({ maxConcurrent, perMinute }) {
    this.maxConcurrent = maxConcurrent;
    this.perMinute = perMinute;
    this.open = new Map();
    this.recent = new Map();
  }

  admit(ip, now = Date.now()) {
    const windowStart = now - (now % 60_000);
    let recent = this.recent.get(ip);
    if (!recent || recent.windowStart !== windowStart) {
      recent = { windowStart, count: 0 };
      this.recent.set(ip, recent);
    }
    if (recent.count >= this.perMinute) return false;
    if ((this.open.get(ip) ?? 0) >= this.maxConcurrent) return false;
    recent.count += 1;
    this.open.set(ip, (this.open.get(ip) ?? 0) + 1);
    return true;
  }

  release(ip) {
    const left = (this.open.get(ip) ?? 1) - 1;
    if (left <= 0) this.open.delete(ip);
    else this.open.set(ip, left);
  }

  sweep(now = Date.now()) {
    const windowStart = now - (now % 60_000);
    for (const [ip, recent] of this.recent) if (recent.windowStart !== windowStart) this.recent.delete(ip);
  }
}

/** Fixed-window request counter for plain HTTP routes. */
class RequestLimiter {
  constructor({ perMinute }) {
    this.perMinute = perMinute;
    this.windows = new Map();
  }

  allow(ip, now = Date.now()) {
    const windowStart = now - (now % 60_000);
    const w = this.windows.get(ip);
    if (!w || w.windowStart !== windowStart) {
      this.windows.set(ip, { windowStart, count: 1 });
      return true;
    }
    w.count += 1;
    return w.count <= this.perMinute;
  }

  sweep(now = Date.now()) {
    const windowStart = now - (now % 60_000);
    for (const [ip, w] of this.windows) if (w.windowStart !== windowStart) this.windows.delete(ip);
  }
}

/**
 * The player's address. Behind `hops` proxies the nearest one appends the address it saw, so the entry `hops` from the end is the client's
 * and anything a client wrote itself sits before it and is ignored. With no proxy the socket address is used.
 */
function clientIp(headers, socketAddress, hops) {
  if (hops > 0) {
    const forwarded = String(headers["x-forwarded-for"] ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (forwarded.length >= hops) return forwarded[forwarded.length - hops];
  }
  return socketAddress || "unknown";
}

module.exports = { EventLimiter, ConnectionLimiter, RequestLimiter, clientIp };
