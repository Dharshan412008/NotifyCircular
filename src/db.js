'use strict';

const path = require('node:path');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');

const SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 100),
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('faculty', 'student')),
    year INTEGER CHECK (year IS NULL OR year BETWEEN 1 AND 4),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT 'CR',
    kind TEXT NOT NULL CHECK (kind IN ('year', 'activity', 'role', 'broadcast', 'custom')),
    joinable INTEGER NOT NULL DEFAULT 0 CHECK (joinable IN (0, 1)),
    year INTEGER CHECK (year IS NULL OR year BETWEEN 1 AND 4),
    department TEXT NOT NULL DEFAULT '',
    parent_group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    creator_faculty_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS student_group_memberships (
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'self' CHECK (source IN ('automatic', 'self', 'faculty', 'seed')),
    joined_at TEXT NOT NULL,
    PRIMARY KEY (student_id, group_id)
  );

  CREATE TABLE IF NOT EXISTS circulars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    faculty_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    text TEXT NOT NULL CHECK (length(text) BETWEEN 5 AND 5000),
    created_at TEXT NOT NULL,
    detected_date TEXT,
    detected_date_text TEXT,
    urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal', 'urgent', 'fyi')),
    summary TEXT NOT NULL,
    requires_acknowledgment INTEGER NOT NULL DEFAULT 0 CHECK (requires_acknowledgment IN (0, 1))
  );

  CREATE TABLE IF NOT EXISTS circular_targets (
    circular_id INTEGER NOT NULL REFERENCES circulars(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    PRIMARY KEY (circular_id, group_id)
  );

  CREATE TABLE IF NOT EXISTS circular_reads (
    circular_id INTEGER NOT NULL REFERENCES circulars(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TEXT,
    acknowledged_at TEXT,
    PRIMARY KEY (circular_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    expiration_time INTEGER,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, endpoint)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    session_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS campus_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    caption TEXT NOT NULL CHECK(length(caption) BETWEEN 1 AND 2000),
    topic TEXT NOT NULL DEFAULT 'general' CHECK(topic IN ('general', 'achievement', 'event', 'opportunity', 'question')),
    image BLOB,
    image_type TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS campus_likes (
    post_id INTEGER NOT NULL REFERENCES campus_posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY(post_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS campus_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES campus_posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 500),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS campus_saved_posts (
    post_id INTEGER NOT NULL REFERENCES campus_posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY(post_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_campus_saved_user ON campus_saved_posts(user_id, post_id);
  CREATE INDEX IF NOT EXISTS idx_campus_comments_post ON campus_comments(post_id, id);

  CREATE INDEX IF NOT EXISTS idx_memberships_group ON student_group_memberships(group_id, student_id);
  CREATE INDEX IF NOT EXISTS idx_targets_group ON circular_targets(group_id, circular_id);
  CREATE INDEX IF NOT EXISTS idx_circulars_created ON circulars(created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_reads_student ON circular_reads(student_id, circular_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
`;

const BUILT_IN_GROUPS = [
  {
    slug: 'first-year',
    name: 'First Year',
    description: 'Notices for first-year and newly admitted students',
    icon: '1Y',
    kind: 'year',
    year: 1,
    joinable: 0,
  },
  {
    slug: 'second-year',
    name: 'Second Year',
    description: 'Notices for second-year students',
    icon: '2Y',
    kind: 'year',
    year: 2,
    joinable: 0,
  },
  {
    slug: 'third-year',
    name: 'Third Year',
    description: 'Notices for third-year students',
    icon: '3Y',
    kind: 'year',
    year: 3,
    joinable: 0,
  },
  {
    slug: 'final-year',
    name: 'Final Year',
    description: 'Placement and academic notices for graduating students',
    icon: '4Y',
    kind: 'year',
    year: 4,
    joinable: 0,
  },
  {
    slug: 'sports',
    name: 'Sports Group',
    description: 'College teams, matches, athletics, and sports activities',
    icon: 'SP',
    kind: 'activity',
    year: null,
    joinable: 1,
  },
  {
    slug: 'faculty',
    name: 'Faculty Group',
    description: 'Faculty and staff notices',
    icon: 'FC',
    kind: 'role',
    year: null,
    joinable: 0,
  },
  {
    slug: 'whole-college',
    name: 'Whole College',
    description: 'Campus-wide notices for every student',
    icon: 'ALL',
    kind: 'broadcast',
    year: null,
    joinable: 0,
  },
];

function utcNow() {
  return new Date().toISOString();
}

function getSetting(db, key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
}

function setSetting(db, key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function enforcePushEndpointOwnership(db) {
  db.transaction(() => {
    db.exec(`
      DELETE FROM push_subscriptions AS stale
      WHERE EXISTS (
        SELECT 1
        FROM push_subscriptions AS current
        WHERE current.endpoint = stale.endpoint
          AND (
            current.updated_at > stale.updated_at OR
            (current.updated_at = stale.updated_at AND current.id > stale.id)
          )
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint
        ON push_subscriptions(endpoint);
    `);
  })();
}

function seedDatabase(db, options = {}) {
  const rounds = options.bcryptRounds || (process.env.NODE_ENV === 'test' ? 4 : 10);
  const now = utcNow();

  const seed = db.transaction(() => {
    const insertGroup = db.prepare(`
      INSERT INTO groups (slug, name, description, icon, kind, joinable, year, created_at)
      VALUES (@slug, @name, @description, @icon, @kind, @joinable, @year, @createdAt)
      ON CONFLICT(slug) DO UPDATE SET
        description = excluded.description,
        icon = excluded.icon
    `);
    for (const group of BUILT_IN_GROUPS) {
      insertGroup.run({ ...group, createdAt: now });
    }

    const insertUser = db.prepare(`
      INSERT OR IGNORE INTO users (name, email, password_hash, role, year, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertUser.run(
      'Dr. Meera Shah',
      'faculty@demo.edu',
      bcrypt.hashSync('Faculty123!', rounds),
      'faculty',
      null,
      now,
    );
    insertUser.run(
      'Prof. Arjun Nair',
      'arjun@demo.edu',
      bcrypt.hashSync('Faculty123!', rounds),
      'faculty',
      null,
      now,
    );
    insertUser.run(
      'Asha Rao',
      'asha@demo.edu',
      bcrypt.hashSync('Student123!', rounds),
      'student',
      1,
      now,
    );
    insertUser.run(
      'Ravi Kumar',
      'ravi@demo.edu',
      bcrypt.hashSync('Student123!', rounds),
      'student',
      4,
      now,
    );

    const membership = db.prepare(`
      INSERT OR IGNORE INTO student_group_memberships
        (student_id, group_id, source, joined_at)
      VALUES (?, ?, ?, ?)
    `);
    const groupId = (slug) => db.prepare('SELECT id FROM groups WHERE slug = ?').get(slug).id;
    const ashaId = db.prepare('SELECT id FROM users WHERE email = ?').get('asha@demo.edu').id;
    const raviId = db.prepare('SELECT id FROM users WHERE email = ?').get('ravi@demo.edu').id;

    membership.run(ashaId, groupId('first-year'), 'automatic', now);
    membership.run(ashaId, groupId('whole-college'), 'automatic', now);
    membership.run(ashaId, groupId('sports'), 'seed', now);
    membership.run(raviId, groupId('final-year'), 'automatic', now);
    membership.run(raviId, groupId('whole-college'), 'automatic', now);

    if (!getSetting(db, 'demo_circulars_v1')) {
      const facultyId = db.prepare('SELECT id FROM users WHERE email = ?').get('faculty@demo.edu').id;
      const insertCircular = db.prepare(`
        INSERT INTO circulars
          (faculty_id, text, created_at, detected_date, detected_date_text, urgency, summary, requires_acknowledgment)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const target = db.prepare(
        'INSERT INTO circular_targets (circular_id, group_id) VALUES (?, ?)',
      );

      let result = insertCircular.run(
        facultyId,
        'Welcome to the new semester. The library and student services desk are open from Monday.',
        new Date(Date.now() - 86_400_000 * 3).toISOString(),
        null,
        null,
        'fyi',
        'New-semester library and student-services information.',
        0,
      );
      target.run(Number(result.lastInsertRowid), groupId('whole-college'));

      result = insertCircular.run(
        facultyId,
        'Urgent: the inter-college football match against St. Xavier\'s is on 15 September 2026. Team members must report by 8 AM.',
        new Date(Date.now() - 86_400_000 * 2).toISOString(),
        '2026-09-15',
        '15 September 2026',
        'urgent',
        'Football team must report for the St. Xavier\'s match.',
        1,
      );
      target.run(Number(result.lastInsertRowid), groupId('sports'));

      result = insertCircular.run(
        facultyId,
        'Final-year placement interviews begin on 30 September 2026. Submit your updated resume to the placement cell.',
        new Date(Date.now() - 86_400_000).toISOString(),
        '2026-09-30',
        '30 September 2026',
        'normal',
        'Final-year placement interviews begin on 30 September.',
        0,
      );
      target.run(Number(result.lastInsertRowid), groupId('final-year'));
      setSetting(db, 'demo_circulars_v1', 'seeded');
    }
  });

  seed();
}

function resolveDatabasePath(requestedPath) {
  if (requestedPath === ':memory:') return requestedPath;
  const filename = path.resolve(
    WORKSPACE_ROOT,
    requestedPath || path.join('data', 'notify-circular.db'),
  );
  const relative = path.relative(WORKSPACE_ROOT, filename);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Database path must stay inside the workspace.');
  }
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  return filename;
}

function openDatabase(options = {}) {
  const env = options.env || process.env;
  const filename = resolveDatabasePath(options.filename || env.DB_PATH);
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (filename !== ':memory:') db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  require('./admin-migration').migrateAdmin(db);
  if (!db.prepare('PRAGMA table_info(campus_posts)').all().some((column) => column.name === 'topic')) {
    db.exec("ALTER TABLE campus_posts ADD COLUMN topic TEXT NOT NULL DEFAULT 'general' CHECK(topic IN ('general', 'achievement', 'event', 'opportunity', 'question'))");
  }
  const groupColumns = db.prepare('PRAGMA table_info(groups)').all().map((column) => column.name);
  if (!groupColumns.includes('department')) db.exec("ALTER TABLE groups ADD COLUMN department TEXT NOT NULL DEFAULT ''");
  if (!groupColumns.includes('section')) db.exec("ALTER TABLE groups ADD COLUMN section TEXT NOT NULL DEFAULT ''");
  if (!groupColumns.includes('parent_group_id')) db.exec('ALTER TABLE groups ADD COLUMN parent_group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_campus_posts_topic ON campus_posts(topic, id)');
  enforcePushEndpointOwnership(db);
  require('./platform').migratePlatform(db);
  require('./circular-tools-migration').migrateCircularTools(db);
  // Provision automatic audiences even when demo people/notices are disabled.
  const addGroup = db.prepare(`INSERT OR IGNORE INTO groups(slug,name,description,icon,kind,joinable,year,created_at)
    VALUES(@slug,@name,@description,@icon,@kind,@joinable,@year,@createdAt)`);
  db.transaction(() => { for (const group of BUILT_IN_GROUPS) addGroup.run({ ...group, createdAt: utcNow() }); })();
  const seedDemo = options.seed ?? (env.NODE_ENV !== 'production' && env.SEED_DEMO_DATA !== 'false');
  if (seedDemo) {
    seedDatabase(db, options);
    if (env.NODE_ENV !== 'production') require('./admin-migration').seedAdmin(db, options);
  }
  return db;
}

module.exports = {
  BUILT_IN_GROUPS,
  WORKSPACE_ROOT,
  getSetting,
  setSetting,
  seedDatabase,
  openDatabase,
  resolveDatabasePath,
  utcNow,
};
