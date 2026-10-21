// A small in-memory stand-in for the parts of the Upstash client the server uses, so Redis-backed code can be tested without a network.
// Values are strings, keys expire against an injectable clock, and it can be told to fail.

class FakeRedis {
  constructor() {
    this.data = new Map();
    this.calls = [];
    this.failWith = null;
    this.now = Date.now;
  }

  count(name) {
    return name ? this.calls.filter((c) => c === name).length : this.calls.length;
  }

  record(name) {
    this.calls.push(name);
    if (this.failWith) throw this.failWith;
  }

  entry(k) {
    const e = this.data.get(k);
    if (!e) return undefined;
    if (e.expiresAt !== null && this.now() >= e.expiresAt) {
      this.data.delete(k);
      return undefined;
    }
    return e;
  }

  keys(prefix = "") {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix) && this.entry(k));
  }

  collection(k, type, create) {
    let e = this.entry(k);
    if (!e && create) {
      e = { type, v: type === "set" ? new Set() : type === "zset" || type === "hash" ? new Map() : null, expiresAt: null };
      this.data.set(k, e);
    }
    return e && e.type === type ? e : undefined;
  }

  async ping() {
    this.record("ping");
    return "PONG";
  }

  async get(k) {
    this.record("get");
    const e = this.entry(k);
    return e && e.type === "string" ? e.v : null;
  }

  async set(k, value, opts = {}) {
    this.record("set");
    if (opts.nx && this.entry(k)) return null;
    const ttl = opts.px ?? (opts.ex !== undefined ? opts.ex * 1000 : undefined);
    this.data.set(k, { type: "string", v: String(value), expiresAt: ttl !== undefined ? this.now() + ttl : null });
    return "OK";
  }

  async del(...ks) {
    this.record("del");
    let n = 0;
    for (const k of ks) if (this.data.delete(k)) n++;
    return n;
  }

  async pexpire(k, ms) {
    this.record("pexpire");
    const e = this.entry(k);
    if (!e) return 0;
    e.expiresAt = this.now() + ms;
    return 1;
  }

  async mget(...ks) {
    this.record("mget");
    return ks.map((k) => {
      const e = this.entry(k);
      return e && e.type === "string" ? e.v : null;
    });
  }

  async sadd(k, ...members) {
    this.record("sadd");
    const s = this.collection(k, "set", true).v;
    let n = 0;
    for (const m of members) if (!s.has(m)) (s.add(m), n++);
    return n;
  }

  async srem(k, ...members) {
    this.record("srem");
    const s = this.collection(k, "set", false)?.v;
    let n = 0;
    if (s) for (const m of members) if (s.delete(m)) n++;
    return n;
  }

  async smembers(k) {
    this.record("smembers");
    return [...(this.collection(k, "set", false)?.v ?? [])];
  }

  async zadd(k, ...args) {
    this.record("zadd");
    const opts = args[0] && !("score" in args[0]) ? args.shift() : {};
    const z = this.collection(k, "zset", true).v;
    let n = 0;
    for (const { score, member } of args) {
      const had = z.get(member);
      if (opts.gt && had !== undefined && score <= had) continue;
      if (opts.nx && had !== undefined) continue;
      z.set(member, score);
      if (had === undefined) n++;
    }
    return n;
  }

  sorted(k) {
    const z = this.collection(k, "zset", false)?.v;
    // Highest score first; equal scores in reverse insertion-independent member order (as Redis orders by member)
    return z ? [...z.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1)) : [];
  }

  async zrange(k, start, stop, opts = {}) {
    this.record("zrange");
    let rows = this.sorted(k);
    if (!opts.rev) rows = rows.reverse();
    rows = rows.slice(start, stop === -1 ? undefined : stop + 1);
    return opts.withScores ? rows.flatMap(([m, s]) => [m, String(s)]) : rows.map(([m]) => m);
  }

  async zrevrank(k, member) {
    this.record("zrevrank");
    const i = this.sorted(k).findIndex(([m]) => m === member);
    return i === -1 ? null : i;
  }

  async zscore(k, member) {
    this.record("zscore");
    const s = this.collection(k, "zset", false)?.v.get(member);
    return s === undefined ? null : String(s);
  }

  async zcard(k) {
    this.record("zcard");
    return this.collection(k, "zset", false)?.v.size ?? 0;
  }

  async zrem(k, ...members) {
    this.record("zrem");
    const z = this.collection(k, "zset", false)?.v;
    let n = 0;
    if (z) for (const m of members) if (z.delete(m)) n++;
    return n;
  }

  async hset(k, fields) {
    this.record("hset");
    const h = this.collection(k, "hash", true).v;
    let n = 0;
    for (const [f, v] of Object.entries(fields)) {
      if (!h.has(f)) n++;
      h.set(f, String(v));
    }
    return n;
  }

  async hmget(k, ...fields) {
    this.record("hmget");
    const h = this.collection(k, "hash", false)?.v;
    // Like the real client: the values in the order asked for
    return fields.map((f) => h?.get(f) ?? null);
  }

  multi() {
    return new Chain(this);
  }
}

class Chain {
  constructor(redis) {
    this.redis = redis;
    this.queue = [];
  }

  add(fn) {
    this.queue.push(fn);
    return this;
  }
}
for (const name of ["set", "del", "pexpire", "sadd", "srem", "zadd", "zrem", "hset"]) {
  Chain.prototype[name] = function (...args) {
    return this.add((r) => r[name](...args));
  };
}
Chain.prototype.exec = async function () {
  const out = [];
  for (const cmd of this.queue) out.push(await cmd(this.redis));
  return out;
};

module.exports = { FakeRedis };
