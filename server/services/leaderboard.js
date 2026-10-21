// Best verified result per player and per team, per test length, kept in Redis sorted sets (all time, and per UTC day).
// A score packs WPM and accuracy into one number so a higher WPM wins and accuracy breaks ties:
//   players  wpm * 1000 + accuracy                  (whole WPM)
//   teams    round(average wpm * 10) * 1000 + accuracy   (the average has one decimal)
// If Redis is unavailable, results are kept in memory and written when it returns; reads fall back to what this process holds.

const { guard, key } = require("../lib/redis");

const DAY_KEY_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const PENDING_LIMIT = 1000;

const dayStamp = (now) => new Date(now).toISOString().slice(0, 10).replace(/-/g, "");

const PLAYER = {
  scope: "player",
  namesKey: () => key("lb", "names"),
  encode: (wpm, accuracy) => wpm * 1000 + Math.round(accuracy),
  decode: (score) => ({ wpm: Math.floor(score / 1000), accuracy: score % 1000 }),
  boardKey: (duration, tail) => key("lb", String(duration), tail),
};

const TEAM = {
  scope: "team",
  namesKey: () => key("lb", "team", "names"),
  encode: (wpm, accuracy) => Math.round(wpm * 10) * 1000 + Math.round(accuracy),
  decode: (score) => ({ wpm: Math.floor(score / 1000) / 10, accuracy: score % 1000 }),
  boardKey: (duration, tail) => key("lb", "team", String(duration), tail),
};

/** One kind of board (players, or teams). */
class ScoreBoard {
  constructor({ spec, settings, clock }) {
    this.spec = spec;
    this.settings = settings;
    this.clock = clock;
    /** Memory copy: board key -> Map(id -> score). Also the fallback while Redis is away. */
    this.local = new Map();
    this.names = new Map();
    this.pending = [];
    this.cache = new Map();
  }

  periodKey(duration, period, now = this.clock()) {
    return this.spec.boardKey(duration, period === "day" ? `day:${dayStamp(now)}` : "all");
  }

  /** Remember a verified result. Never throws. */
  async record({ id, name, duration, wpm, accuracy }) {
    const score = this.spec.encode(wpm, accuracy);
    const now = this.clock();
    const keys = [this.periodKey(duration, "all", now), this.periodKey(duration, "day", now)];
    this.applyLocal(keys, id, name, score);
    this.cache.clear();

    try {
      await this.writeToRedis(keys, id, name, score);
    } catch {
      if (this.pending.length < PENDING_LIMIT) this.pending.push({ keys, id, name, score });
    }
  }

  applyLocal(keys, id, name, score) {
    this.names.set(id, name);
    for (const k of keys) {
      const board = this.local.get(k) ?? new Map();
      if ((board.get(id) ?? -1) < score) board.set(id, score);
      this.local.set(k, board);
    }
  }

  async writeToRedis(keys, id, name, score) {
    await guard.run(`leaderboard.${this.spec.scope}.record`, (r) => {
      const tx = r.multi();
      for (const k of keys) tx.zadd(k, { gt: true }, { score, member: id });
      tx.hset(this.spec.namesKey(), { [id]: name });
      tx.pexpire(keys[1], DAY_KEY_TTL_MS);
      return tx.exec();
    });
  }

  /** Writes results that could not be written earlier. Called on a timer. */
  async flushPending() {
    while (this.pending.length > 0) {
      const next = this.pending[0];
      try {
        await this.writeToRedis(next.keys, next.id, next.name, next.score);
      } catch {
        return;
      }
      this.pending.shift();
    }
  }

  /** Takes an id off every board (a team was disqualified or dissolved). Never throws. */
  async remove(id) {
    const keys = [];
    for (const duration of this.settings.validDurations) {
      keys.push(this.periodKey(duration, "all"));
      // The daily boards of the days still kept
      for (let back = 0; back < 4; back++) keys.push(this.periodKey(duration, "day", this.clock() - back * 86_400_000));
    }
    for (const k of keys) this.local.get(k)?.delete(id);
    this.pending = this.pending.filter((p) => p.id !== id);
    this.cache.clear();
    try {
      await guard.run(`leaderboard.${this.spec.scope}.remove`, (r) => {
        const tx = r.multi();
        for (const k of keys) tx.zrem(k, id);
        return tx.exec();
      });
    } catch {
      // Redis is away: the entries it holds are removed the next time this is called for the same id
    }
  }

  async top({ duration, period, limit }) {
    const cacheKey = `${duration}:${period}:${limit}:${period === "day" ? dayStamp(this.clock()) : ""}`;
    const hit = this.cache.get(cacheKey);
    if (hit && this.clock() - hit.at < this.settings.leaderboardCacheMs) return hit.value;

    const k = this.periodKey(duration, period);
    let rows;
    let total;
    try {
      const flat = await guard.run(`leaderboard.${this.spec.scope}.top`, (r) => r.zrange(k, 0, limit - 1, { rev: true, withScores: true }));
      total = await guard.run(`leaderboard.${this.spec.scope}.count`, (r) => r.zcard(k));
      const ids = [];
      rows = [];
      for (let i = 0; i < flat.length; i += 2) {
        ids.push(flat[i]);
        rows.push({ id: flat[i], score: Number(flat[i + 1]) });
      }
      const stored = ids.length ? await guard.run(`leaderboard.${this.spec.scope}.names`, (r) => r.hmget(this.spec.namesKey(), ...ids)) : [];
      // The client returns the values in the order asked for (older versions returned an object keyed by field)
      rows.forEach((row, i) => {
        const name = Array.isArray(stored) ? stored[i] : stored?.[row.id];
        row.name = name ?? this.names.get(row.id) ?? "Unknown";
      });
    } catch {
      const board = this.local.get(k) ?? new Map();
      const sorted = [...board.entries()].sort((a, b) => b[1] - a[1]);
      total = sorted.length;
      rows = sorted.slice(0, limit).map(([id, score]) => ({ id, score, name: this.names.get(id) ?? "Unknown" }));
    }

    const entries = rows.map((row, index) => ({ rank: index + 1, id: row.id, name: row.name, ...this.spec.decode(row.score) }));
    const value = { entries, total };
    this.cache.set(cacheKey, { at: this.clock(), value });
    return value;
  }

  /** One id's rank and result, or null when it has none for this board. */
  async standing({ duration, period, id }) {
    const k = this.periodKey(duration, period);
    try {
      const rank = await guard.run(`leaderboard.${this.spec.scope}.rank`, (r) => r.zrevrank(k, id));
      if (rank === null || rank === undefined) return null;
      const score = await guard.run(`leaderboard.${this.spec.scope}.rank`, (r) => r.zscore(k, id));
      return { rank: Number(rank) + 1, ...this.spec.decode(Number(score)) };
    } catch {
      const board = this.local.get(k);
      const score = board?.get(id);
      if (score === undefined) return null;
      const better = [...board.values()].filter((s) => s > score).length;
      return { rank: better + 1, ...this.spec.decode(score) };
    }
  }
}

/** The player board, and the team board. The methods without a prefix are the player board's, as before. */
class Leaderboard {
  constructor({ settings, clock = Date.now }) {
    this.settings = settings;
    this.players = new ScoreBoard({ spec: PLAYER, settings, clock });
    this.teams = new ScoreBoard({ spec: TEAM, settings, clock });
  }

  record(entry) {
    return this.players.record(entry);
  }

  top(query) {
    return this.players.top(query);
  }

  standing(query) {
    return this.players.standing(query);
  }

  get pending() {
    return this.players.pending;
  }

  async flushPending() {
    await this.players.flushPending();
    await this.teams.flushPending();
  }
}

const encode = PLAYER.encode;
const decode = PLAYER.decode;

module.exports = { Leaderboard, ScoreBoard, encode, decode };
