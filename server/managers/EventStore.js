const { Pool } = require("pg");

class EventStore {
  constructor({ connectionString = process.env.DATABASE_URL } = {}) {
    if (!connectionString) {
      throw new Error("DATABASE_URL must be configured for event persistence");
    }
    this.pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS event_state (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS event_history (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        archived_at BIGINT NOT NULL
      )
    `);
  }

  async load() {
    const { rows } = await this.pool.query("SELECT payload FROM event_state WHERE id = 1");
    return rows[0] ? JSON.parse(rows[0].payload) : null;
  }

  enqueueWrite(write) {
    const operation = this.writeQueue.then(write);
    this.writeQueue = operation.catch(error => {
      console.error("Event database write failed:", error);
    });
    return operation;
  }

  save(payload) {
    const serialized = JSON.stringify(payload);
    return this.enqueueWrite(() => this.pool.query(
      `INSERT INTO event_state (id, payload, updated_at) VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
      [serialized, Date.now()],
    ));
  }

  archive(payload) {
    const serialized = JSON.stringify(payload);
    return this.enqueueWrite(() => this.pool.query(
      `INSERT INTO event_history (id, payload, archived_at) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, archived_at = EXCLUDED.archived_at`,
      [payload.id, serialized, Date.now()],
    ));
  }

  async listHistory() {
    const { rows } = await this.pool.query("SELECT payload FROM event_history ORDER BY archived_at DESC");
    return rows.map(row => JSON.parse(row.payload));
  }

  async getHistory(id) {
    const { rows } = await this.pool.query("SELECT payload FROM event_history WHERE id = $1", [id]);
    return rows[0] ? JSON.parse(rows[0].payload) : null;
  }

  async close() {
    await this.writeQueue;
    await this.pool.end();
  }
}

module.exports = EventStore;
