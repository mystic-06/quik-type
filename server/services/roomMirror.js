// Keeps a copy of every room in Redis, so a restart or a redeploy in the middle of a game comes back to where it was.
//
// The game itself runs in memory. Each change marks a room dirty; a debounced flush writes only dirty rooms, in one transaction, and a failed
// flush is retried with a growing delay, so the copy catches up by itself when Redis returns.
// Only one server may write: a lease key held by the running process. A second server on the same Redis cannot get it and does not start,
// because two servers each holding their own rooms and writing to one copy would corrupt it.

const { randomUUID } = require("node:crypto");
const { guard, key, RedisUnavailableError } = require("../lib/redis");

const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 15_000;

class LeaseHeldError extends Error {
  constructor(holder) {
    super("Another server holds the room-state lease for this Redis.");
    this.name = "LeaseHeldError";
    this.holder = holder;
  }
}

class RoomMirror {
  constructor({ manager, settings }) {
    this.manager = manager;
    this.settings = settings;
    this.instanceId = randomUUID();
    this.dirty = new Set();
    this.removed = new Set();
    this.timer = null;
    this.leaseTimer = null;
    this.running = null;
    this.retryDelayMs = RETRY_MIN_MS;
    this.enabled = false;
    this.holdsLease = false;
    this.status = { enabled: false, holdsLease: false, lastFlushAt: 0, lastError: "" };
  }

  /* ---------------------------------------------------------------------------------------------- the lease */

  /** Takes the lease, waiting up to `waitMs` for a crashed previous server's lease to run out. Throws LeaseHeldError if it never frees. */
  async acquireLease(waitMs = this.settings.leaseTtlMs + 2000) {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const won = await guard.run("lease.acquire", (r) => r.set(key("lease"), this.instanceId, { nx: true, px: this.settings.leaseTtlMs }));
      let holder = null;
      if (won === null || won === undefined) {
        holder = await guard.run("lease.peek", (r) => r.get(key("lease")));
      }
      if (!(won === null || won === undefined) || holder === this.instanceId) {
        this.setHolding(true);
        this.startLeaseRenewal();
        return;
      }
      if (Date.now() >= deadline) throw new LeaseHeldError(holder);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  setHolding(value) {
    this.holdsLease = value;
    this.status.holdsLease = value;
  }

  startLeaseRenewal() {
    if (this.leaseTimer) return;
    this.leaseTimer = setInterval(() => void this.renewLease(), this.settings.leaseRenewMs);
    this.leaseTimer.unref?.();
  }

  async renewLease() {
    try {
      const holder = await guard.run("lease.renew", (r) => r.get(key("lease")));
      if (holder === null || holder === undefined) {
        // It ran out while Redis was unreachable: take it back if nobody else has
        const won = await guard.run("lease.renew", (r) => r.set(key("lease"), this.instanceId, { nx: true, px: this.settings.leaseTtlMs }));
        this.setHolding(won !== null && won !== undefined);
      } else if (holder === this.instanceId) {
        await guard.run("lease.renew", (r) => r.pexpire(key("lease"), this.settings.leaseTtlMs));
        this.setHolding(true);
      } else {
        this.setHolding(false);
        console.error(`[Rooms] Another server (${holder}) now holds the Redis lease. This one stops saving to Redis.`);
      }
    } catch (err) {
      if (!(err instanceof RedisUnavailableError)) throw err;
      // Redis is unreachable: keep believing we hold it and check again next time
    }
  }

  async releaseLease() {
    if (this.leaseTimer) {
      clearInterval(this.leaseTimer);
      this.leaseTimer = null;
    }
    if (!this.holdsLease) return;
    try {
      const holder = await guard.run("lease.release", (r) => r.get(key("lease")));
      if (holder === this.instanceId) await guard.run("lease.release", (r) => r.del(key("lease")));
    } catch {
      // It will run out by itself
    }
    this.setHolding(false);
  }

  /* ---------------------------------------------------------------------------------------------- saving */

  enable() {
    this.enabled = true;
    this.status.enabled = true;
    // Everything restored from Redis is already there; anything else in memory is written on the first flush
    for (const id of this.manager.rooms.keys()) this.dirty.add(id);
    this.schedule(0);
  }

  disable() {
    this.enabled = false;
    this.status.enabled = false;
    clearTimeout(this.timer);
    this.timer = null;
  }

  markDirty(id) {
    this.removed.delete(id);
    this.dirty.add(id);
    this.schedule();
  }

  markRemoved(id) {
    this.dirty.delete(id);
    this.removed.add(id);
    this.schedule();
  }

  schedule(delayMs = this.settings.flushDebounceMs) {
    if (!this.enabled || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushNow();
    }, delayMs);
    this.timer.unref?.();
  }

  /** Writes what changed. Resolves true when Redis has everything. Never throws. */
  async flushNow() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.running) {
      await this.running;
      return this.flushNow();
    }
    this.running = this.flushOnce().finally(() => {
      this.running = null;
    });
    await this.running;
    return this.status.lastError === "";
  }

  async flushOnce() {
    if (!this.enabled) return;
    const dirty = [...this.dirty];
    const removed = [...this.removed];
    this.dirty.clear();
    this.removed.clear();
    try {
      if (!this.holdsLease) await this.acquireLease(0);
      if (dirty.length > 0 || removed.length > 0) {
        const writes = [];
        for (const id of dirty) {
          const room = this.manager.rooms.get(id);
          if (room) writes.push([id, JSON.stringify(this.manager.serialize(room)), room.kind === "team" ? this.settings.teamRoomTtlMs : this.settings.roomTtlMs]);
          else removed.push(id);
        }
        await guard.run("rooms.flush", (r) => {
          const tx = r.multi();
          for (const [id, json, ttl] of writes) {
            tx.set(key("room", id), json, { px: ttl });
            tx.sadd(key("rooms"), id);
          }
          for (const id of removed) {
            tx.del(key("room", id));
            tx.srem(key("rooms"), id);
          }
          return tx.exec();
        });
      }
      this.retryDelayMs = RETRY_MIN_MS;
      this.status.lastError = "";
      this.status.lastFlushAt = Date.now();
    } catch (err) {
      // Put the work back, so the next attempt includes it
      for (const id of dirty) if (!this.removed.has(id)) this.dirty.add(id);
      for (const id of removed) if (!this.dirty.has(id)) this.removed.add(id);
      this.status.lastError = err instanceof Error ? err.message : String(err);
      if (err instanceof LeaseHeldError) console.error("[Rooms] Not saving to Redis: another server holds the lease.");
      const delay = this.retryDelayMs;
      this.retryDelayMs = Math.min(RETRY_MAX_MS, this.retryDelayMs * 2);
      this.schedule(delay);
    }
  }

  /* ---------------------------------------------------------------------------------------------- loading */

  /** The saved rooms. Throws RedisUnavailableError if Redis cannot be reached. */
  async load() {
    const ids = await guard.run("rooms.load", (r) => r.smembers(key("rooms")));
    const rooms = [];
    const gone = [];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const raws = await guard.run("rooms.load", (r) => r.mget(...chunk.map((id) => key("room", id))));
      raws.forEach((raw, j) => {
        if (typeof raw !== "string") {
          gone.push(chunk[j]); // expired
          return;
        }
        try {
          rooms.push(JSON.parse(raw));
        } catch {
          console.warn(`[Rooms] Skipping unreadable room ${chunk[j]} in Redis.`);
        }
      });
    }
    if (gone.length > 0) {
      try {
        await guard.run("rooms.load", (r) => r.srem(key("rooms"), ...gone));
      } catch {
        // tidy-up only
      }
    }
    return rooms;
  }

  /** Deletes every saved room (not the lease). */
  async clear() {
    const ids = await guard.run("rooms.clear", (r) => r.smembers(key("rooms")));
    const names = [...ids.map((id) => key("room", id)), key("rooms")];
    for (let i = 0; i < names.length; i += 100) {
      const chunk = names.slice(i, i + 100);
      await guard.run("rooms.clear", (r) => r.del(...chunk));
    }
    this.dirty.clear();
    this.removed.clear();
    return names.length;
  }

  /** Saves everything now and gives the lease up. For a clean shutdown. */
  async shutdown(timeoutMs = 3000) {
    // A recent blip may have paused Redis. This is the last chance to save, so make one real attempt regardless.
    guard.reset();
    if (this.enabled) {
      for (const id of this.manager.rooms.keys()) this.dirty.add(id);
      await Promise.race([this.flushNow(), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
    }
    this.disable();
    await this.releaseLease();
  }
}

module.exports = { RoomMirror, LeaseHeldError };
