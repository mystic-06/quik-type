const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

class EventStore {
  constructor() {
    const configuredPath = process.env.EVENT_DATABASE_PATH || path.join(process.cwd(), "data", "event.sqlite");
    fs.mkdirSync(path.dirname(configuredPath), { recursive: true });
    this.db = new DatabaseSync(configuredPath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    this.db.exec("CREATE TABLE IF NOT EXISTS event_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    this.db.exec("CREATE TABLE IF NOT EXISTS event_history (id TEXT PRIMARY KEY, payload TEXT NOT NULL, archived_at INTEGER NOT NULL)");
    this.readStatement = this.db.prepare("SELECT payload FROM event_state WHERE id = 1");
    this.writeStatement = this.db.prepare("INSERT INTO event_state (id, payload, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at");
    this.archiveStatement = this.db.prepare("INSERT INTO event_history (id, payload, archived_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, archived_at = excluded.archived_at");
    this.listHistoryStatement = this.db.prepare("SELECT payload FROM event_history ORDER BY archived_at DESC");
    this.readHistoryStatement = this.db.prepare("SELECT payload FROM event_history WHERE id = ?");
  }

  load() {
    const row = this.readStatement.get();
    return row ? JSON.parse(row.payload) : null;
  }

  save(payload) {
    this.writeStatement.run(JSON.stringify(payload), Date.now());
  }

  archive(payload) {
    this.archiveStatement.run(payload.id, JSON.stringify(payload), Date.now());
  }

  listHistory() {
    return this.listHistoryStatement.all().map(row => JSON.parse(row.payload));
  }

  getHistory(id) {
    const row = this.readHistoryStatement.get(id);
    return row ? JSON.parse(row.payload) : null;
  }
}

module.exports = EventStore;
