'use strict';
const express = require('express');
const { z } = require('zod');
const { requireAuth, requireRole } = require('./auth');
const { assert } = require('./errors');
const { cleanInteger, cleanString, requireObject } = require('./validation');
const { hydrateCircular, userCanReceiveCircular, listGroups } = require('./repository');

function migratePlatform(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profiles(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      register_number TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '', program TEXT NOT NULL DEFAULT '',
      section TEXT NOT NULL DEFAULT '', academic_year TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS notification_preferences(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      circular INTEGER NOT NULL DEFAULT 1, event INTEGER NOT NULL DEFAULT 1, social INTEGER NOT NULL DEFAULT 1,
      email INTEGER NOT NULL DEFAULT 1, digest TEXT NOT NULL DEFAULT 'instant' CHECK(digest IN ('instant','daily')));
    CREATE TABLE IF NOT EXISTS platform_notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, title TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '', href TEXT NOT NULL, circular_id INTEGER REFERENCES circulars(id) ON DELETE CASCADE,
      post_id INTEGER REFERENCES campus_posts(id) ON DELETE CASCADE, source_key TEXT NOT NULL,
      created_at TEXT NOT NULL, read_at TEXT, cleared_at TEXT, UNIQUE(user_id,source_key));
    CREATE INDEX IF NOT EXISTS idx_platform_notifications_user ON platform_notifications(user_id,id);
    CREATE TABLE IF NOT EXISTS saved_circulars(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      circular_id INTEGER NOT NULL REFERENCES circulars(id) ON DELETE CASCADE, PRIMARY KEY(user_id,circular_id));
    CREATE TABLE IF NOT EXISTS delivery_log(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      circular_id INTEGER REFERENCES circulars(id) ON DELETE CASCADE,channel TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS digest_queue(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      circular_id INTEGER NOT NULL REFERENCES circulars(id) ON DELETE CASCADE,created_at TEXT NOT NULL,
      PRIMARY KEY(user_id,circular_id));
    CREATE TABLE IF NOT EXISTS digest_runs(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,last_sent_at TEXT NOT NULL);
  `);
}

const VISIBILITY = `(c.faculty_id = @id AND @role = 'faculty') OR
  (@role = 'student' AND EXISTS(SELECT 1 FROM circular_targets ct JOIN student_group_memberships m ON m.group_id=ct.group_id WHERE ct.circular_id=c.id AND m.student_id=@id)) OR
  (@role = 'faculty' AND EXISTS(SELECT 1 FROM circular_targets ct JOIN groups g ON g.id=ct.group_id WHERE ct.circular_id=c.id AND g.kind='role'))`;
function params(user) { return { id: user.id, role: user.role }; }
function accessibleRows(db, user, { search = '', limit = 100, offset = 0, saved = false } = {}) {
  return db.prepare(`SELECT c.*,u.id AS faculty_user_id,u.name AS faculty_name,u.email AS faculty_email
    FROM circulars c JOIN users u ON u.id=c.faculty_id WHERE (${VISIBILITY})
    AND (@saved=0 OR EXISTS(SELECT 1 FROM saved_circulars s WHERE s.user_id=@id AND s.circular_id=c.id))
    AND (@q='' OR instr(lower(c.text||' '||c.summary||' '||u.name||' '||coalesce(c.detected_date,'')),@q)>0 OR
      EXISTS(SELECT 1 FROM circular_targets ct JOIN groups g ON g.id=ct.group_id WHERE ct.circular_id=c.id AND instr(lower(g.name),@q)>0))
    ORDER BY c.created_at DESC,c.id DESC LIMIT @limit OFFSET @offset`).all({ ...params(user), q: search.toLowerCase(), limit, offset, saved: saved ? 1 : 0 });
}
function decorate(db, row, user) {
  return hydrateCircular(db, row, user.role === 'faculty' && row.faculty_id === user.id ? { includeStats: true } : { recipientId: user.id });
}
function preferences(db, id) {
  const row = db.prepare('SELECT * FROM notification_preferences WHERE user_id=?').get(id);
  return { circular: row ? Boolean(row.circular) : true, event: row ? Boolean(row.event) : true,
    social: row ? Boolean(row.social) : true, email: row ? Boolean(row.email) : true, digest: row?.digest || 'instant' };
}
function addNotification(db, { userId, kind, title, message = '', href, circularId = null, postId = null, key }) {
  if (!preferences(db, userId)[kind === 'reaction' || kind === 'comment' ? 'social' : kind === 'deadline' ? 'event' : 'circular']) return;
  db.prepare(`INSERT OR IGNORE INTO platform_notifications(user_id,kind,title,message,href,circular_id,post_id,source_key,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(userId, kind, title, message, href, circularId, postId, key, new Date().toISOString());
}
function syncNotifications(db, user) {
  const prefs = preferences(db, user.id);
  if (!prefs.circular && !prefs.event) return;
  const rows = accessibleRows(db, user, { limit: 200 });
  const day = new Date(); day.setDate(day.getDate() + 3);
  const today = new Date().toISOString().slice(0, 10), until = day.toISOString().slice(0, 10);
  for (const row of rows) {
    if (row.faculty_id === user.id) continue;
    const href = user.role === 'student' ? `/student/circulars/${row.id}` : '/faculty/sent';
    addNotification(db, { userId: user.id, kind: 'circular', title: row.requires_acknowledgment ? 'Acknowledgment required' : 'New circular', message: row.summary, href, circularId: row.id, key: `circular:${row.id}` });
    if (row.detected_date >= today && row.detected_date <= until) addNotification(db, { userId: user.id, kind: 'deadline', title: `Upcoming: ${row.detected_date}`, message: row.summary, href, circularId: row.id, key: `deadline:${row.id}:${row.detected_date}` });
  }
}
function allowedNotification(db, n, user) {
  if (n.circular_id) return userCanReceiveCircular(db, user.id, n.circular_id);
  return true;
}

function platformRouter(db) {
  const router = express.Router();
  router.use(requireAuth);
  router.get('/analytics', requireRole('faculty'), (req, res) => {
    const days = cleanInteger(req.query.days ?? 30, 'days', { min: 1, max: 365 });
    res.json(require('./analytics').facultyAnalytics(db, req.user.id, days));
  });
  router.get('/overview', (req, res) => {
    const user = req.user;
    const rows = accessibleRows(db, user, { limit: 6 });
    const aggregate = db.prepare(`SELECT count(*) AS total,
      sum(CASE WHEN cr.read_at IS NULL THEN 1 ELSE 0 END) AS unread,
      sum(CASE WHEN c.urgency='urgent' THEN 1 ELSE 0 END) AS urgent,
      sum(CASE WHEN c.requires_acknowledgment=1 AND cr.acknowledged_at IS NULL THEN 1 ELSE 0 END) AS pending,
      sum(CASE WHEN c.detected_date>=date('now') THEN 1 ELSE 0 END) AS upcoming
      FROM circulars c LEFT JOIN circular_reads cr ON cr.circular_id=c.id AND cr.student_id=@id WHERE (${VISIBILITY})`).get(params(user));
    const sent = db.prepare('SELECT id FROM circulars WHERE faculty_id=?').all(user.id);
    const stats = { ...aggregate, savedPosts: db.prepare('SELECT count(*) n FROM campus_saved_posts WHERE user_id=?').get(user.id).n,
      sent: sent.length, recipients: 0, readRate: 0, acknowledgmentRate: 0, groups: listGroups(db, user).length };
    if (user.role === 'faculty') {
      let read = 0, ack = 0, requires = 0;
      const reached = new Set();
      for (const row of sent) {
        const circular = hydrateCircular(db, row.id, { includeStats: true });
        stats.recipients += circular.stats.audience; read += circular.stats.read;
        for (const recipient of require('./repository').audienceRows(db, row.id)) reached.add(recipient.id);
        if (circular.requiresAcknowledgment) { requires += circular.stats.audience; ack += circular.stats.acknowledged; }
      }
      stats.readRate = stats.recipients ? Math.round(read / stats.recipients * 100) : 0;
      stats.acknowledgmentRate = requires ? Math.round(ack / requires * 100) : 0;
      stats.pending = requires - ack;
      stats.recipientOpportunities = stats.recipients;
      stats.recipients = reached.size;
    }
    const events = db.prepare(`SELECT c.*,u.id faculty_user_id,u.name faculty_name,u.email faculty_email FROM circulars c JOIN users u ON u.id=c.faculty_id WHERE (${VISIBILITY}) AND detected_date>=date('now') ORDER BY detected_date,c.id LIMIT 5`).all(params(user)).map((row) => decorate(db, row, user));
    const posts = db.prepare(`SELECT p.id,p.caption,p.topic,p.created_at createdAt,u.name authorName,(SELECT count(*) FROM campus_likes l WHERE l.post_id=p.id) likeCount FROM campus_posts p JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 4`).all();
    syncNotifications(db, user);
    const activity = db.prepare('SELECT id,title,message,href,circular_id,post_id,created_at createdAt FROM platform_notifications WHERE user_id=? AND cleared_at IS NULL ORDER BY id DESC LIMIT 100').all(user.id).filter((n) => allowedNotification(db, n, user)).slice(0, 5);
    const engagement = db.prepare(`SELECT substr(created_at,1,10) label,count(*) sent FROM circulars WHERE faculty_id=? GROUP BY label ORDER BY label DESC LIMIT 7`).all(user.id).reverse();
    res.json({ stats, notices: rows.map((row) => decorate(db, row, user)), events, posts, activity, engagement });
  });
  router.get('/search', (req, res) => {
    const q = cleanString(req.query.q ?? '', 'search', { max: 100 });
    if (!q.trim()) return res.json({ results: [] });
    const role = req.user.role;
    const notices = accessibleRows(db, req.user, { search: q, limit: 15 }).map((row) => ({ id: `c-${row.id}`, kind: row.detected_date ? 'Event / circular' : 'Circular', title: row.summary, subtitle: row.faculty_name, href: role === 'student' ? `/student/circulars/${row.id}` : `/faculty/sent${row.faculty_id === req.user.id ? `/${row.id}` : ''}` }));
    const groups = listGroups(db, req.user).filter((g) => `${g.name} ${g.description}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8).map((g) => ({ id: `g-${g.id}`, kind: 'Group', title: g.name, subtitle: g.description, href: `/${role}/groups` }));
    const posts = db.prepare(`SELECT p.id,p.caption,p.topic,u.name FROM campus_posts p JOIN users u ON u.id=p.user_id WHERE instr(lower(p.caption||' '||u.name||' '||p.topic),?)>0 ORDER BY p.id DESC LIMIT 10`).all(q.toLowerCase()).map((p) => ({ id: `p-${p.id}`, kind: 'Campus post', title: p.caption.slice(0, 120), subtitle: p.name, href: `/${role}/campus?post=${p.id}` }));
    const people = db.prepare(`SELECT id,name,role FROM users WHERE disabled=0 AND instr(lower(name),?)>0 LIMIT 8`).all(q.toLowerCase()).map((p) => ({ id: `u-${p.id}`, kind: 'Person', title: p.name, subtitle: p.role, href: `/${role}/campus?author=${encodeURIComponent(p.name)}` }));
    res.json({ results: [...notices, ...groups, ...posts, ...people] });
  });
  router.get('/circulars', (req, res) => {
    const offset = cleanInteger(req.query.offset ?? 0, 'offset', { min: 0, max: 100000 });
    const rows = accessibleRows(db, req.user, { search: cleanString(req.query.q ?? '', 'search', { max: 100 }), offset, limit: 21, saved: req.query.saved === 'true' });
    res.json({ circulars: rows.slice(0, 20).map((row) => decorate(db, row, req.user)), hasMore: rows.length > 20 });
  });
  router.get('/events', (req, res) => {
    const rows = db.prepare(`SELECT c.*,u.id faculty_user_id,u.name faculty_name,u.email faculty_email FROM circulars c JOIN users u ON u.id=c.faculty_id WHERE (${VISIBILITY}) AND detected_date IS NOT NULL ORDER BY detected_date,c.id`).all(params(req.user));
    res.json({ events: rows.map((row) => decorate(db, row, req.user)) });
  });
  router.put('/circulars/:id/save', requireRole('student'), (req, res) => {
    const id = cleanInteger(req.params.id, 'id', { min: 1 });
    assert(userCanReceiveCircular(db, req.user.id, id), 404, 'not_found', 'Circular unavailable.');
    db.prepare('INSERT OR IGNORE INTO saved_circulars(user_id,circular_id) VALUES(?,?)').run(req.user.id, id);
    res.json({ ok: true });
  });
  router.delete('/circulars/:id/save', requireRole('student'), (req, res) => {
    db.prepare('DELETE FROM saved_circulars WHERE user_id=? AND circular_id=?').run(req.user.id, cleanInteger(req.params.id, 'id', { min: 1 })); res.json({ ok: true });
  });
  router.get('/notifications', (req, res) => {
    syncNotifications(db, req.user);
    const notifications = db.prepare(`SELECT *,created_at createdAt,read_at readAt FROM platform_notifications WHERE user_id=? AND cleared_at IS NULL ORDER BY id DESC LIMIT 100`).all(req.user.id).filter((n) => allowedNotification(db, n, req.user));
    res.json({ notifications, unread: notifications.filter((n) => !n.read_at).length });
  });
  router.post('/notifications/read', (req, res) => {
    const body = requireObject(req.body); const id = body.id === undefined ? null : cleanInteger(body.id, 'id', { min: 1 });
    db.prepare('UPDATE platform_notifications SET read_at=coalesce(read_at,?) WHERE user_id=? AND (? IS NULL OR id=?)').run(new Date().toISOString(), req.user.id, id, id); res.json({ ok: true });
  });
  router.delete('/notifications', (req, res) => {
    db.prepare('UPDATE platform_notifications SET cleared_at=? WHERE user_id=?').run(new Date().toISOString(), req.user.id); res.json({ ok: true });
  });
  router.get('/preferences', (req, res) => res.json({ preferences: preferences(db, req.user.id) }));
  router.put('/preferences', (req, res) => {
    const schema = z.object({ circular: z.boolean(), event: z.boolean(), social: z.boolean(), email: z.boolean(), digest: z.enum(['instant', 'daily']) });
    const result = schema.safeParse(req.body); assert(result.success, 400, 'validation_error', 'Choose valid notification preferences.');
    const p = result.data;
    db.prepare(`INSERT INTO notification_preferences VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET circular=excluded.circular,event=excluded.event,social=excluded.social,email=excluded.email,digest=excluded.digest`).run(req.user.id, +p.circular, +p.event, +p.social, +p.email, p.digest);
    res.json({ preferences: p });
  });
  router.get('/profile', (req, res) => res.json({ profile: { ...req.user, ...db.prepare('SELECT * FROM user_profiles WHERE user_id=?').get(req.user.id) } }));
  router.put('/profile', (req, res) => {
    const schema = z.object({ name: z.string().trim().min(2).max(100), register_number: z.string().trim().max(50), department: z.string().trim().max(80), program: z.string().trim().max(80), section: z.string().trim().max(30), academic_year: z.string().trim().max(30), bio: z.string().trim().max(500) });
    const parsed = schema.safeParse(req.body); assert(parsed.success, 400, 'validation_error', 'Check the profile fields and try again.');
    const p = parsed.data;
    db.transaction(() => {
      db.prepare('UPDATE users SET name=? WHERE id=?').run(p.name, req.user.id);
      db.prepare(`INSERT INTO user_profiles VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET register_number=excluded.register_number,department=excluded.department,program=excluded.program,section=excluded.section,academic_year=excluded.academic_year,bio=excluded.bio`).run(req.user.id, p.register_number, p.department, p.program, p.section, p.academic_year, p.bio);
    })();
    res.json({ ok: true });
  });
  router.post('/audience-preview', requireRole('faculty'), (req, res) => {
    const schema = z.object({
      groupIds: z.array(z.number().int().positive()).max(25),
      department: z.string().trim().max(80).default(''),
      year: z.number().int().min(1).max(4).optional(),
      program: z.string().trim().max(80).default(''),
      section: z.string().trim().max(30).default(''),
      academicYear: z.string().trim().max(30).default(''),
    });
    const parsed = schema.safeParse(req.body); assert(parsed.success, 400, 'validation_error', 'Choose valid audience filters.');
    const p = parsed.data;
    const filteredMembers = db.prepare(`SELECT DISTINCT u.id,u.name,u.year FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id
      WHERE u.role='student' AND u.disabled=0 AND (?='' OR lower(p.department)=lower(?)) AND (?='' OR lower(p.program)=lower(?))
      AND (?='' OR lower(p.section)=lower(?)) AND (?='' OR lower(p.academic_year)=lower(?)) AND (? IS NULL OR u.year=?)
      AND EXISTS(SELECT 1 FROM student_group_memberships m WHERE m.student_id=u.id AND m.group_id IN (SELECT value FROM json_each(?)))`)
      .all(p.department, p.department, p.program, p.program, p.section, p.section, p.academicYear, p.academicYear, p.year ?? null, p.year ?? null, JSON.stringify(p.groupIds));
    const memberships = db.prepare('SELECT count(*) n FROM student_group_memberships WHERE group_id IN (SELECT value FROM json_each(?))').get(JSON.stringify(p.groupIds)).n;
    res.json({ count: filteredMembers.length, memberships, members: filteredMembers.slice(0, 100) });
  });
  return router;
}

module.exports = { migratePlatform, platformRouter, preferences, addNotification, syncNotifications, accessibleRows };
