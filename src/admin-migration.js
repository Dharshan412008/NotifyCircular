'use strict';

const bcrypt = require('bcryptjs');

// Rebuild only users, with foreign keys disabled outside the transaction. Child
// tables keep their original users references and every existing column is copied.
function migrateAdmin(db) {
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql;
  if (!schema) throw new Error('Create the base schema before applying the admin migration.');
  const foreignKeys = db.pragma('foreign_keys', { simple: true });
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      if (!/['"]admin['"]/.test(schema)) {
        const updated = schema.replace(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`\[]?users["`\]]?/i, 'CREATE TABLE users_admin_migration')
          .replace(/role\s+IN\s*\(\s*'faculty'\s*,\s*'student'\s*\)/i, "role IN ('faculty', 'student', 'admin')");
        if (updated === schema || !updated.includes("'admin'")) throw new Error('Unrecognized users role constraint; migration stopped without changing data.');
        const extras = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = 'users' AND type IN ('index', 'trigger') AND sql IS NOT NULL").all();
        const columns = db.prepare('PRAGMA table_info(users)').all().map((column) => `"${column.name.replaceAll('"', '""')}"`).join(', ');
        db.exec(updated);
        db.exec(`INSERT INTO users_admin_migration (${columns}) SELECT ${columns} FROM users; DROP TABLE users; ALTER TABLE users_admin_migration RENAME TO users;`);
        for (const extra of extras) db.exec(extra.sql);
      }
      if (!db.prepare('PRAGMA table_info(users)').all().some((column) => column.name === 'disabled')) {
        db.exec('ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0, 1))');
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          action TEXT NOT NULL,
          resource TEXT NOT NULL,
          resource_id TEXT,
          metadata TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(id DESC);
        CREATE TABLE IF NOT EXISTS campus_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          target_type TEXT NOT NULL CHECK(target_type IN ('post', 'comment')),
          target_id INTEGER NOT NULL,
          post_id INTEGER NOT NULL,
          content_snapshot TEXT NOT NULL,
          reason TEXT NOT NULL CHECK(length(reason) BETWEEN 5 AND 1000),
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'dismissed', 'removed')),
          resolution_note TEXT NOT NULL DEFAULT '',
          resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          resolved_at TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_campus_reports_pending_reporter
          ON campus_reports(reporter_id, target_type, target_id) WHERE status = 'pending';
        CREATE INDEX IF NOT EXISTS idx_campus_reports_status ON campus_reports(status, id DESC);
      `);
      const violations = db.pragma('foreign_key_check');
      if (violations.length) throw new Error('Admin migration failed foreign-key validation; changes rolled back.');
    })();
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
}

function seedAdmin(db, options = {}) {
  const rounds = options.bcryptRounds || (process.env.NODE_ENV === 'test' ? 4 : 10);
  db.prepare(`INSERT OR IGNORE INTO users(name, email, password_hash, role, year, created_at)
    VALUES (?, ?, ?, 'admin', NULL, ?)`).run('Campus Administrator', 'admin@demo.edu', bcrypt.hashSync('Admin123!', rounds), new Date().toISOString());
}

module.exports = { migrateAdmin, seedAdmin };
