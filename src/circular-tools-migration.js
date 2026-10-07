'use strict';

// Additive migration: existing circulars, memberships, reads, and accounts stay intact.
function migrateCircularTools(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS circular_work_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      faculty_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('draft', 'template', 'scheduled')),
      name TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'scheduled', 'sent', 'cancelled', 'failed')),
      send_at TEXT,
      circular_id INTEGER UNIQUE REFERENCES circulars(id) ON DELETE SET NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_circular_work_owner ON circular_work_items(faculty_id, updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_circular_work_due ON circular_work_items(status, send_at);

    CREATE TABLE IF NOT EXISTS circular_metadata (
      circular_id INTEGER PRIMARY KEY REFERENCES circulars(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'general',
      priority TEXT NOT NULL DEFAULT 'normal',
      event_time TEXT,
      location TEXT NOT NULL DEFAULT '',
      deadline TEXT,
      pinned_until TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_circular_metadata_category ON circular_metadata(category, circular_id);
    CREATE INDEX IF NOT EXISTS idx_circular_metadata_deadline ON circular_metadata(deadline);
    CREATE TABLE IF NOT EXISTS circular_revision_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      circular_id INTEGER NOT NULL REFERENCES circulars(id) ON DELETE CASCADE,
      faculty_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      previous_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS circular_files (
      id TEXT PRIMARY KEY,
      faculty_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL CHECK(size > 0),
      content BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_circular_files_owner ON circular_files(faculty_id);
    CREATE TABLE IF NOT EXISTS circular_file_links (
      circular_id INTEGER NOT NULL REFERENCES circulars(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL REFERENCES circular_files(id) ON DELETE RESTRICT,
      PRIMARY KEY(circular_id, file_id)
    );
    CREATE INDEX IF NOT EXISTS idx_circular_file_links_file ON circular_file_links(file_id, circular_id);

    CREATE TABLE IF NOT EXISTS circular_dispatch_jobs (
      circular_id INTEGER PRIMARY KEY REFERENCES circulars(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'delivering', 'sent')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      lease_until TEXT,
      last_error TEXT,
      delivered_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_circular_dispatch_due ON circular_dispatch_jobs(status, next_attempt_at);

    CREATE TABLE IF NOT EXISTS circular_attendance_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      circular_id INTEGER NOT NULL REFERENCES circulars(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_circular_attendance_tokens_notice ON circular_attendance_tokens(circular_id, expires_at);
    CREATE TABLE IF NOT EXISTS circular_attendance (
      circular_id INTEGER NOT NULL REFERENCES circulars(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      checked_in_at TEXT NOT NULL,
      PRIMARY KEY(circular_id, student_id)
    );
  `);
}

module.exports = { migrateCircularTools };
