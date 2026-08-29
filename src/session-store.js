'use strict';

const session = require('express-session');

class SQLiteSessionStore extends session.Store {
  constructor(db, options = {}) {
    super();
    this.db = db;
    this.defaultTtlMs = options.defaultTtlMs || 7 * 24 * 60 * 60 * 1000;
    this.operationsSincePrune = 0;
  }

  expiryFor(sessionData) {
    const expires = sessionData?.cookie?.expires;
    if (expires) {
      const timestamp = new Date(expires).getTime();
      if (Number.isFinite(timestamp)) return timestamp;
    }
    const maxAge = Number(sessionData?.cookie?.maxAge);
    return Date.now() + (Number.isFinite(maxAge) ? maxAge : this.defaultTtlMs);
  }

  get(sid, callback) {
    try {
      const row = this.db
        .prepare('SELECT session_json, expires_at FROM sessions WHERE sid = ?')
        .get(sid);
      if (!row) return callback(null, null);
      if (row.expires_at <= Date.now()) {
        this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.session_json));
    } catch (error) {
      return callback(error);
    }
  }

  set(sid, sessionData, callback = () => {}) {
    try {
      this.db
        .prepare(`
          INSERT INTO sessions (sid, session_json, expires_at)
          VALUES (?, ?, ?)
          ON CONFLICT(sid) DO UPDATE SET
            session_json = excluded.session_json,
            expires_at = excluded.expires_at
        `)
        .run(sid, JSON.stringify(sessionData), this.expiryFor(sessionData));
      this.operationsSincePrune += 1;
      if (this.operationsSincePrune >= 100) {
        this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
        this.operationsSincePrune = 0;
      }
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sessionData, callback = () => {}) {
    try {
      this.db
        .prepare('UPDATE sessions SET expires_at = ?, session_json = ? WHERE sid = ?')
        .run(this.expiryFor(sessionData), JSON.stringify(sessionData), sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  clear(callback = () => {}) {
    try {
      this.db.prepare('DELETE FROM sessions').run();
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}

module.exports = { SQLiteSessionStore };
