'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { requireAuth, requireRole } = require('./auth');
const { assert, asyncRoute } = require('./errors');
const { cleanString, cleanEmail, cleanPassword, cleanInteger, cleanBoolean, requireObject, slugify } = require('./validation');

const now = () => new Date().toISOString();
const DEFAULT_CONFIG = { collegeName: 'CampusRelay', supportEmail: '', campusGuidelines: 'Share respectfully. Keep campus posts relevant to college life and protect personal information.', registrationOpen: true };
const publicUser = (row) => ({ id: row.id, name: row.name, email: row.email, role: row.role, year: row.year, disabled: Boolean(row.disabled), createdAt: row.created_at });
const cursor = (query) => query.before === undefined ? Number.MAX_SAFE_INTEGER : cleanInteger(query.before, 'before', { min: 1 });
const page = (rows) => ({ items: rows.slice(0, 30), nextCursor: rows.length > 30 ? rows[29].id : null });

function audit(db, { actorId = null, action, resource, resourceId = null, metadata = {} }) {
  db.prepare('INSERT INTO audit_logs(actor_id, action, resource, resource_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(actorId, action, resource, resourceId === null ? null : String(resourceId), JSON.stringify(metadata), now());
}

function getCollegeConfig(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'college_config_v1'").get();
  if (!row) return { ...DEFAULT_CONFIG };
  try {
    const stored = JSON.parse(row.value);
    return Object.fromEntries(Object.entries(DEFAULT_CONFIG).map(([key, fallback]) => [key, typeof stored[key] === typeof fallback ? stored[key] : fallback]));
  } catch { return { ...DEFAULT_CONFIG }; }
}

function revokeSessions(db, userId) {
  db.prepare("DELETE FROM sessions WHERE CASE WHEN json_valid(session_json) THEN CAST(json_extract(session_json, '$.userId') AS INTEGER) = ? ELSE 0 END").run(userId);
}

function assignAutomaticGroups(db, userId, year) {
  db.prepare("DELETE FROM student_group_memberships WHERE student_id = ? AND group_id IN (SELECT id FROM groups WHERE kind = 'year')").run(userId);
  db.prepare(`INSERT OR IGNORE INTO student_group_memberships(student_id, group_id, source, joined_at)
    SELECT ?, id, 'automatic', ? FROM groups WHERE (kind = 'year' AND year = ?) OR kind = 'broadcast'`).run(userId, now(), year);
}

function adminRouter(db) {
  const router = express.Router();
  router.use(requireRole('admin'));
  router.use(express.json({ limit: '32kb' }));
  const userById = (id) => {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(cleanInteger(id, 'user id', { min: 1 }));
    assert(row, 404, 'user_not_found', 'This account could not be found.');
    return row;
  };
  const groupById = (id) => {
    const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(cleanInteger(id, 'group id', { min: 1 }));
    assert(row, 404, 'group_not_found', 'This group could not be found.');
    return row;
  };
  const manageable = (group) => assert(['activity', 'custom'].includes(group.kind), 400, 'automatic_group', 'Automatic and faculty groups are managed by account roles and academic years.');

  router.get('/stats', (_req, res) => {
    const counts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'student') AS students,
      (SELECT COUNT(*) FROM users WHERE role = 'faculty') AS faculty,
      (SELECT COUNT(*) FROM users WHERE disabled = 0) AS enabledUsers,
      (SELECT COUNT(*) FROM users WHERE disabled = 1) AS disabledUsers,
      (SELECT COUNT(*) FROM circulars) AS circulars,
      (SELECT COUNT(*) FROM groups) AS groups,
      (SELECT COUNT(*) FROM campus_posts) AS posts,
      (SELECT COUNT(*) FROM campus_reports WHERE status = 'pending') AS pendingReports,
      (SELECT COUNT(*) FROM circular_reads WHERE read_at IS NOT NULL) AS reads,
      (SELECT COUNT(*) FROM circular_reads WHERE acknowledged_at IS NOT NULL) AS acknowledgments`).get();
    const growth = db.prepare("SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count FROM users WHERE created_at >= date('now', '-29 days') GROUP BY day ORDER BY day").all();
    const activity = db.prepare("SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count FROM circulars WHERE created_at >= date('now', '-29 days') GROUP BY day ORDER BY day").all();
    res.json({ counts, growth, activity });
  });

  router.get('/users', (req, res) => {
    const q = cleanString(req.query.q ?? '', 'search', { max: 100 }).toLowerCase();
    const role = req.query.role ?? 'all';
    assert(['all', 'student', 'faculty', 'admin'].includes(role), 400, 'validation_error', 'Choose a valid role.');
    const rows = db.prepare(`SELECT id, name, email, role, year, disabled, created_at FROM users
      WHERE id < ? AND (? = 'all' OR role = ?) AND (? = '' OR instr(lower(name), ?) > 0 OR instr(lower(email), ?) > 0)
      ORDER BY id DESC LIMIT 31`).all(cursor(req.query), role, role, q, q, q);
    const result = page(rows);
    res.json({ users: result.items.map(publicUser), nextCursor: result.nextCursor });
  });

  router.post('/users', asyncRoute(async (req, res) => {
    const body = requireObject(req.body);
    const name = cleanString(body.name, 'name', { min: 2, max: 100 });
    const email = cleanEmail(body.email);
    const password = cleanPassword(body.password);
    assert(['faculty', 'student'].includes(body.role), 400, 'validation_error', 'Create a faculty or student account.');
    const year = body.role === 'student' ? cleanInteger(body.year, 'year', { min: 1, max: 4 }) : null;
    const hash = await bcrypt.hash(password, req.app.get('env') === 'test' ? 4 : 12);
    const id = db.transaction(() => {
      assert(!db.prepare('SELECT id FROM users WHERE email = ?').get(email), 409, 'email_in_use', 'An account already exists for this email.');
      const result = db.prepare('INSERT INTO users(name, email, password_hash, role, year, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(name, email, hash, body.role, year, now());
      const userId = Number(result.lastInsertRowid);
      if (body.role === 'student') assignAutomaticGroups(db, userId, year);
      audit(db, { actorId: req.user.id, action: 'user.created', resource: 'user', resourceId: userId, metadata: { role: body.role } });
      return userId;
    })();
    res.status(201).json({ user: publicUser(userById(id)) });
  }));

  router.patch('/users/:id', (req, res) => {
    const target = userById(req.params.id);
    const body = requireObject(req.body);
    assert(Object.keys(body).some((key) => ['name', 'email', 'role', 'year', 'disabled'].includes(key)), 400, 'validation_error', 'Choose an account field to update.');
    const name = body.name === undefined ? target.name : cleanString(body.name, 'name', { min: 2, max: 100 });
    const email = body.email === undefined ? target.email : cleanEmail(body.email);
    const role = body.role === undefined ? target.role : body.role;
    assert(role === target.role || (target.role !== 'admin' && ['faculty', 'student'].includes(role)), 400, 'protected_role', 'Administrator roles cannot be assigned or removed here.');
    const year = role === 'student' ? cleanInteger(body.year ?? target.year, 'year', { min: 1, max: 4 }) : null;
    const disabled = body.disabled === undefined ? Boolean(target.disabled) : cleanBoolean(body.disabled, 'disabled');
    assert(!(target.id === req.user.id && (disabled || role !== target.role)), 400, 'self_change', 'You cannot disable your own account or change your own role.');
    if (target.role === 'admin' && disabled) {
      assert(db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?").get(target.id).n > 0, 400, 'last_admin', 'Keep at least one enabled administrator.');
    }
    assert(!db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, target.id), 409, 'email_in_use', 'An account already exists for this email.');
    db.transaction(() => {
      db.prepare('UPDATE users SET name = ?, email = ?, role = ?, year = ?, disabled = ? WHERE id = ?').run(name, email, role, year, Number(disabled), target.id);
      if (role === 'student' && (target.role !== 'student' || target.year !== year)) assignAutomaticGroups(db, target.id, year);
      if (role !== 'student' && target.role === 'student') db.prepare('DELETE FROM student_group_memberships WHERE student_id = ?').run(target.id);
      if (disabled || role !== target.role) revokeSessions(db, target.id);
      audit(db, { actorId: req.user.id, action: 'user.updated', resource: 'user', resourceId: target.id, metadata: { fields: Object.keys(body).filter((key) => ['name', 'email', 'role', 'year', 'disabled'].includes(key)), role, disabled } });
    })();
    if (disabled || role !== target.role) req.app.locals.disconnectUserSockets?.(target.id);
    res.json({ user: publicUser(userById(target.id)) });
  });

  router.get('/groups', (req, res) => {
    const q = cleanString(req.query.q ?? '', 'search', { max: 100 }).toLowerCase();
    const rows = db.prepare(`SELECT g.*, (SELECT COUNT(*) FROM student_group_memberships m WHERE m.group_id = g.id) AS memberCount,
      (SELECT COUNT(*) FROM circular_targets ct WHERE ct.group_id = g.id) AS circularCount
      FROM groups g WHERE g.id < ? AND (? = '' OR instr(lower(g.name), ?) > 0) ORDER BY g.id DESC LIMIT 31`).all(cursor(req.query), q, q);
    const result = page(rows);
    res.json({ groups: result.items, nextCursor: result.nextCursor });
  });
  router.get('/groups/create-options', (_req, res) => res.json(require('./group-creation').groupOptions(db)));
  router.post('/groups', (req, res) => {
    res.status(201).json({ group: require('./group-creation').createGroup(db, req.user, req.body) });
  });
  router.patch('/groups/:id', (req, res) => {
    const group = groupById(req.params.id);
    manageable(group);
    const body = requireObject(req.body);
    const name = cleanString(body.name ?? group.name, 'name', { min: 2, max: 100 });
    const description = cleanString(body.description ?? group.description, 'description', { max: 500 });
    const joinable = body.joinable === undefined ? Boolean(group.joinable) : cleanBoolean(body.joinable, 'joinable');
    assert(!db.prepare('SELECT id FROM groups WHERE name = ? AND id != ?').get(name, group.id), 409, 'group_exists', 'A group with this name already exists.');
    db.transaction(() => {
      db.prepare('UPDATE groups SET name = ?, description = ?, joinable = ? WHERE id = ?').run(name, description, Number(joinable), group.id);
      audit(db, { actorId: req.user.id, action: 'group.updated', resource: 'group', resourceId: group.id });
    })();
    res.json({ group: groupById(group.id) });
  });
  router.get('/groups/:id/members', (req, res) => {
    const group = groupById(req.params.id);
    const rows = db.prepare(`SELECT u.id, u.name, u.email, u.year, u.disabled FROM users u JOIN student_group_memberships m ON m.student_id = u.id
      WHERE m.group_id = ? AND u.id < ? ORDER BY u.id DESC LIMIT 31`).all(group.id, cursor(req.query));
    const result = page(rows);
    res.json({ members: result.items, nextCursor: result.nextCursor });
  });
  router.put('/groups/:id/members/:userId', (req, res) => {
    const group = groupById(req.params.id);
    manageable(group);
    const student = userById(req.params.userId);
    assert(student.role === 'student' && !student.disabled, 400, 'validation_error', 'Choose an enabled student account.');
    db.transaction(() => {
      db.prepare("INSERT OR IGNORE INTO student_group_memberships(student_id, group_id, source, joined_at) VALUES (?, ?, 'faculty', ?)").run(student.id, group.id, now());
      audit(db, { actorId: req.user.id, action: 'membership.added', resource: 'group', resourceId: group.id, metadata: { studentId: student.id } });
    })();
    res.json({ ok: true });
  });
  router.delete('/groups/:id/members/:userId', (req, res) => {
    const group = groupById(req.params.id);
    manageable(group);
    const userId = cleanInteger(req.params.userId, 'student id', { min: 1 });
    db.transaction(() => {
      db.prepare('DELETE FROM student_group_memberships WHERE student_id = ? AND group_id = ?').run(userId, group.id);
      audit(db, { actorId: req.user.id, action: 'membership.removed', resource: 'group', resourceId: group.id, metadata: { studentId: userId } });
    })();
    res.json({ ok: true });
  });

  router.get('/reports', (req, res) => {
    const status = req.query.status ?? 'pending';
    assert(['pending', 'dismissed', 'removed', 'all'].includes(status), 400, 'validation_error', 'Choose a valid report status.');
    const rows = db.prepare(`SELECT r.*, reporter.name AS reporterName, author.name AS authorName,
      EXISTS(SELECT 1 FROM campus_posts p WHERE p.id = r.post_id AND p.image_type IS NOT NULL) AS hasImage
      FROM campus_reports r LEFT JOIN users reporter ON reporter.id = r.reporter_id LEFT JOIN users author ON author.id = r.author_id
      WHERE r.id < ? AND (? = 'all' OR r.status = ?) ORDER BY r.id DESC LIMIT 31`).all(cursor(req.query), status, status);
    const result = page(rows);
    res.json({ reports: result.items, nextCursor: result.nextCursor });
  });
  router.post('/reports/:id/resolve', (req, res) => {
    const id = cleanInteger(req.params.id, 'report id', { min: 1 });
    const report = db.prepare('SELECT * FROM campus_reports WHERE id = ?').get(id);
    assert(report, 404, 'report_not_found', 'This report could not be found.');
    assert(report.status === 'pending', 409, 'report_resolved', 'This report has already been reviewed.');
    const body = requireObject(req.body);
    assert(['dismiss', 'remove'].includes(body.action), 400, 'validation_error', 'Choose dismiss or remove.');
    const note = cleanString(body.note ?? '', 'resolution note', { max: 1000 });
    db.transaction(() => {
      const timestamp = now();
      if (body.action === 'remove') {
        if (report.target_type === 'post') {
          db.prepare("UPDATE campus_reports SET status = 'removed', resolved_by = ?, resolved_at = ?, resolution_note = ? WHERE post_id = ? AND status = 'pending'").run(req.user.id, timestamp, note, report.post_id);
          db.prepare('DELETE FROM campus_posts WHERE id = ?').run(report.target_id);
        } else {
          db.prepare("UPDATE campus_reports SET status = 'removed', resolved_by = ?, resolved_at = ?, resolution_note = ? WHERE target_type = 'comment' AND target_id = ? AND status = 'pending'").run(req.user.id, timestamp, note, report.target_id);
          db.prepare('DELETE FROM campus_comments WHERE id = ?').run(report.target_id);
        }
      } else {
        db.prepare("UPDATE campus_reports SET status = 'dismissed', resolved_by = ?, resolved_at = ?, resolution_note = ? WHERE id = ?").run(req.user.id, timestamp, note, id);
      }
      audit(db, { actorId: req.user.id, action: `moderation.${body.action}`, resource: report.target_type, resourceId: report.target_id, metadata: { reportId: id, note } });
    })();
    res.json({ ok: true });
  });

  router.get('/audit', (req, res) => {
    const rows = db.prepare(`SELECT a.id, a.actor_id AS actorId, u.name AS actorName, a.action, a.resource, a.resource_id AS resourceId, a.metadata, a.created_at AS createdAt
      FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id WHERE a.id < ? ORDER BY a.id DESC LIMIT 31`).all(cursor(req.query));
    const result = page(rows);
    res.json({ entries: result.items.map((entry) => ({ ...entry, metadata: JSON.parse(entry.metadata) })), nextCursor: result.nextCursor });
  });
  router.get('/notifications', (req, res) => {
    const subscriptions = db.prepare(`SELECT COUNT(*) AS subscriptions, COUNT(DISTINCT user_id) AS subscribedUsers FROM push_subscriptions
      WHERE expiration_time IS NULL OR expiration_time > ?`).get(Date.now());
    const service = req.app.locals.notificationService;
    const deliveries = db.prepare('SELECT channel,status,count(*) count FROM delivery_log GROUP BY channel,status').all();
    const digestQueued = db.prepare('SELECT count(*) count FROM digest_queue').get().count;
    res.json({ ...subscriptions, deliveries, digestQueued, emailMode: service?.emailMode || 'local-preview', outboundDisabled: Boolean(service?.disabled) });
  });
  router.get('/config', (_req, res) => res.json({ config: getCollegeConfig(db) }));
  router.put('/config', (req, res) => {
    const body = requireObject(req.body);
    assert(Object.keys(body).every((key) => Object.hasOwn(DEFAULT_CONFIG, key)), 400, 'validation_error', 'Choose a supported college setting.');
    const previous = getCollegeConfig(db);
    const config = {
      collegeName: cleanString(body.collegeName ?? previous.collegeName, 'college name', { min: 2, max: 100 }),
      supportEmail: body.supportEmail === undefined ? previous.supportEmail : body.supportEmail === '' ? '' : cleanEmail(body.supportEmail),
      campusGuidelines: cleanString(body.campusGuidelines ?? previous.campusGuidelines, 'campus guidelines', { max: 2000 }),
      registrationOpen: body.registrationOpen === undefined ? previous.registrationOpen : cleanBoolean(body.registrationOpen, 'registration open'),
    };
    db.transaction(() => {
      db.prepare("INSERT INTO settings(key, value) VALUES ('college_config_v1', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(config));
      audit(db, { actorId: req.user.id, action: 'config.updated', resource: 'college', metadata: { fields: Object.keys(body) } });
    })();
    res.json({ config });
  });
  return router;
}

function reportsRouter(db) {
  const router = express.Router();
  router.use(requireAuth);
  router.use(express.json({ limit: '8kb' }));
  router.post('/', (req, res) => {
    const body = requireObject(req.body);
    assert(['post', 'comment'].includes(body.targetType), 400, 'validation_error', 'Choose a post or comment to report.');
    const targetId = cleanInteger(body.targetId, 'content id', { min: 1 });
    const reason = cleanString(body.reason, 'report reason', { min: 5, max: 1000 });
    const target = body.targetType === 'post'
      ? db.prepare('SELECT user_id, caption AS content, id AS post_id FROM campus_posts WHERE id = ?').get(targetId)
      : db.prepare('SELECT user_id, text AS content, post_id FROM campus_comments WHERE id = ?').get(targetId);
    assert(target, 404, 'content_not_found', 'This content is no longer available.');
    const existing = db.prepare("SELECT id FROM campus_reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'pending'").get(req.user.id, body.targetType, targetId);
    if (existing) return res.json({ id: existing.id, status: 'pending' });
    const recent = db.prepare("SELECT COUNT(*) AS n FROM campus_reports WHERE reporter_id = ? AND julianday(created_at) >= julianday('now', '-1 day')").get(req.user.id).n;
    assert(recent < 100, 429, 'report_limit', 'You have submitted many reports today. Please try again tomorrow.');
    const result = db.prepare('INSERT INTO campus_reports(reporter_id, author_id, target_type, target_id, post_id, content_snapshot, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.user.id, target.user_id, body.targetType, targetId, target.post_id, target.content, reason, now());
    res.status(201).json({ id: Number(result.lastInsertRowid), status: 'pending' });
  });
  return router;
}

module.exports = { adminRouter, reportsRouter, audit, getCollegeConfig };
