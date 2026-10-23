'use strict';
const express = require('express');
const crypto = require('node:crypto');
const { requireAuth, requireRole } = require('./auth');
const { assert } = require('./errors');
const { cleanString, cleanInteger, cleanIdArray, requireObject } = require('./validation');
const now = () => new Date().toISOString();
const normal = v => String(v || '').trim().replace(/\s+/g, ' ').toUpperCase();
const hash = v => crypto.createHash('sha256').update(v).digest('hex');

function migrateGovernance(db) {
  const columns = db.prepare('PRAGMA table_info(groups)').all().map(c => c.name);
  for (const [name, type] of [['category', "TEXT NOT NULL DEFAULT 'community'"], ['sports_type', "TEXT NOT NULL DEFAULT ''"], ['sports_name', "TEXT NOT NULL DEFAULT ''"], ['student_manager_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL']]) {
    if (!columns.includes(name)) db.exec(`ALTER TABLE groups ADD COLUMN ${name} ${type}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS staff_designations(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,PRIMARY KEY(user_id,name));
    CREATE TABLE IF NOT EXISTS group_staff(group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(group_id,user_id));
    CREATE TABLE IF NOT EXISTS group_creation_requests(id INTEGER PRIMARY KEY,faculty_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,reviewed_at TEXT);
    CREATE TABLE IF NOT EXISTS group_invitations(id INTEGER PRIMARY KEY,group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,revoked_at TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS group_join_requests(id INTEGER PRIMARY KEY,group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,invitation_id INTEGER REFERENCES group_invitations(id) ON DELETE SET NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,created_at TEXT NOT NULL,reviewed_at TEXT,UNIQUE(group_id,student_id));
    CREATE INDEX IF NOT EXISTS idx_join_requests_group_status ON group_join_requests(group_id,status);
    CREATE INDEX IF NOT EXISTS idx_group_requests_status ON group_creation_requests(status,id);`);
  if (!db.prepare('PRAGMA table_info(group_join_requests)').all().some(c => c.name === 'via_invitation')) db.exec('ALTER TABLE group_join_requests ADD COLUMN via_invitation INTEGER NOT NULL DEFAULT 0');
  db.prepare('UPDATE group_join_requests SET via_invitation=1 WHERE invitation_id IS NOT NULL AND via_invitation=0').run();
}
function designations(db, id) { return db.prepare('SELECT name FROM staff_designations WHERE user_id=? ORDER BY name').all(id).map(r => r.name); }
function isPT(db, id) { return designations(db, id).some(d => ['PT', 'PT STAFF', 'PHYSICAL EDUCATION', 'PHYSICAL EDUCATION TEACHER', 'PHYSICAL DIRECTOR'].includes(normal(d))); }
function managerDepartment(db, group) {
  const seen = new Set();
  while (group) {
    if (group.department) return group.department;
    if (!group.parent_group_id || seen.has(group.parent_group_id)) break;
    seen.add(group.parent_group_id);
    group = db.prepare('SELECT department,parent_group_id FROM groups WHERE id=?').get(group.parent_group_id);
  }
  return '';
}
function facultyEligible(db, id, group) {
  const f = db.prepare("SELECT u.id,coalesce(p.department,'') department FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=? AND u.role='faculty' AND u.disabled=0").get(id);
  const department = managerDepartment(db,group);
  return Boolean(f && (group.category === 'sports' ? isPT(db, id) : !department || normal(f.department) === normal(department)));
}
function canManage(db, user, groupId) {
  if (user.role === 'admin') return true;
  if (user.role !== 'faculty') return false;
  const group = db.prepare('SELECT * FROM groups WHERE id=?').get(groupId);
  if (!group || !facultyEligible(db, user.id, group)) return false;
  if (group.academic_level === 'section') {
    const cls = db.prepare('SELECT id FROM academic_classes WHERE group_id=?').get(groupId);
    return Boolean(cls && require('./academics').classAccess(db, user, cls.id));
  }
  return Boolean(db.prepare('SELECT 1 FROM group_staff WHERE group_id=? AND user_id=?').get(groupId, user.id));
}
function managedGroup(db, user, id) {
  id = cleanInteger(id, 'groupId', { min: 1 });
  const group = db.prepare('SELECT * FROM groups WHERE id=?').get(id);
  assert(group && canManage(db, user, id), 403, 'group_forbidden', 'Only an administrator or assigned faculty manager can manage this group.');
  return group;
}
function governanceSettings(db, group, body) {
  const category = body.category ?? 'community';
  assert(['community', 'club', 'sports', 'exam'].includes(category), 400, 'validation_error', 'Choose a valid group category.');
  const department = managerDepartment(db, group);
  const facultyIds = cleanIdArray(body.facultyIds ?? [], 'facultyIds', { max: 50 });
  assert(facultyIds.every(id => facultyEligible(db, id, { department, category })), 400, 'staff_ineligible', category === 'sports' ? 'Sports groups require staff with an administrator-assigned PT designation.' : 'Choose active faculty from this department.');
  const studentManagerId = body.studentManagerId ? cleanInteger(body.studentManagerId, 'studentManagerId', { min: 1 }) : null;
  assert(!studentManagerId || category === 'club' && db.prepare("SELECT 1 FROM users WHERE id=? AND role='student' AND disabled=0").get(studentManagerId), 400, 'validation_error', 'Student manager labels are available only for active students in clubs.');
  const sportsType = cleanString(body.sportsType ?? '', 'sportsType', { max: 80 });
  const sportsName = cleanString(body.sportsName ?? '', 'sportsName', { max: 80 });
  assert(category !== 'sports' || sportsType && sportsName, 400, 'validation_error', 'Enter the sports type and sports name.');
  return { category, facultyIds, studentManagerId, sportsType, sportsName };
}
function saveGovernance(db, group, body) {
  const settings = governanceSettings(db, group, body);
  db.prepare('UPDATE groups SET category=?,sports_type=?,sports_name=?,student_manager_id=? WHERE id=?').run(settings.category, settings.sportsType, settings.sportsName, settings.studentManagerId, group.id);
  db.prepare('DELETE FROM group_staff WHERE group_id=?').run(group.id);
  for (const id of settings.facultyIds) db.prepare('INSERT INTO group_staff VALUES(?,?)').run(group.id, id);
  return settings;
}
function requestJoin(db, user, groupId, invitationId = null) {
  const group = db.prepare('SELECT * FROM groups WHERE id=?').get(groupId);
  assert(user.role === 'student', 403, 'forbidden', 'Only students can request membership.');
  assert(group && !group.academic_level && ['activity', 'custom'].includes(group.kind) && (group.joinable || invitationId), 403, 'membership_locked', 'This group is not open for membership requests.');
  assert(require('./academics').matchesProfile(db, user.id, group), 403, 'class_mismatch', 'This invitation does not match your saved year, department or section.');
  if (db.prepare('SELECT 1 FROM student_group_memberships WHERE group_id=? AND student_id=?').get(groupId, user.id)) return 'member';
  const existing = db.prepare('SELECT status FROM group_join_requests WHERE group_id=? AND student_id=?').get(groupId, user.id);
  if (existing?.status === 'rejected') return 'rejected';
  db.prepare(`INSERT INTO group_join_requests(group_id,student_id,invitation_id,created_at,via_invitation) VALUES(?,?,?,?,?) ON CONFLICT(group_id,student_id) DO UPDATE SET status='pending',reviewer_id=NULL,reviewed_at=NULL,invitation_id=excluded.invitation_id,created_at=excluded.created_at,via_invitation=excluded.via_invitation`).run(groupId, user.id, invitationId, now(), Number(Boolean(invitationId)));
  return 'pending';
}
function governanceRouter(db) {
  const router = express.Router();
  router.use(requireAuth);
  router.get('/staff', requireRole('admin'), (_req, res) => {
    res.json({ staff: db.prepare("SELECT u.id,u.name,u.email,coalesce(p.department,'') department,coalesce(p.employee_id,'') employeeId FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.role='faculty' AND u.disabled=0 ORDER BY u.name").all().map(f => ({ ...f, designations: designations(db, f.id) })) });
  });
  router.put('/staff/:id/designations', requireRole('admin'), (req, res) => {
    const id = cleanInteger(req.params.id, 'staffId', { min: 1 }), body = requireObject(req.body);
    assert(db.prepare("SELECT 1 FROM users WHERE id=? AND role='faculty' AND disabled=0").get(id), 400, 'validation_error', 'Choose an active faculty account.');
    assert(Array.isArray(body.designations) && body.designations.length <= 12, 400, 'validation_error', 'Add up to 12 designations.');
    const names = [...new Set(body.designations.map(v => cleanString(v, 'designation', { min: 1, max: 80 })).map(normal))];
    db.transaction(() => {
      db.prepare('DELETE FROM staff_designations WHERE user_id=?').run(id);
      for (const name of names) db.prepare('INSERT INTO staff_designations VALUES(?,?)').run(id, name);
      if (body.department !== undefined || body.employeeId !== undefined) {
        const old = db.prepare('SELECT department,employee_id FROM user_profiles WHERE user_id=?').get(id) || {};
        const department = cleanString(body.department ?? old.department ?? '', 'department', { max: 80 });
        const employeeId = cleanString(body.employeeId ?? old.employee_id ?? '', 'employeeId', { max: 50 });
        db.prepare('INSERT INTO user_profiles(user_id,department,employee_id) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET department=excluded.department,employee_id=excluded.employee_id').run(id, department, employeeId);
      }
      require('./admin').audit(db, { actorId: req.user.id, action: 'staff.designations', resource: 'user', resourceId: id, metadata: { designations: names } });
    })();
    res.json({ designations: names });
  });
  router.get('/requests', (req, res) => {
    assert(['faculty', 'admin'].includes(req.user.role), 403, 'forbidden', 'Faculty or administrator access required.');
    const rows = db.prepare(`SELECT r.*,u.name facultyName FROM group_creation_requests r JOIN users u ON u.id=r.faculty_id WHERE (?='admin' OR r.faculty_id=?) ORDER BY CASE WHEN r.status='pending' THEN 0 ELSE 1 END,r.id DESC LIMIT 200`).all(req.user.role, req.user.id);
    res.json({ requests: rows.map(r => ({ ...r, payload: JSON.parse(r.payload) })) });
  });
  router.post('/requests', requireRole('faculty'), (req, res) => {
    const payload = require('./group-creation').normalizeGroup(req.user, req.body);
    require('./group-creation').validateProposal(db,payload);
    assert(db.prepare("SELECT count(*) n FROM group_creation_requests WHERE faculty_id=? AND status='pending'").get(req.user.id).n < 20, 429, 'request_limit', 'Wait for your pending group requests to be reviewed.');
    // Requests contain proposals only; no groups or memberships exist until approved.
    const result = db.prepare('INSERT INTO group_creation_requests(faculty_id,payload,created_at) VALUES(?,?,?)').run(req.user.id, JSON.stringify(payload), now());
    require('./admin').audit(db, { actorId: req.user.id, action: 'group.requested', resource: 'group-request', resourceId: result.lastInsertRowid });
    res.status(201).json({ requestId: Number(result.lastInsertRowid), status: 'pending' });
  });
  router.post('/requests/:id/review', requireRole('admin'), (req, res) => {
    const id = cleanInteger(req.params.id, 'requestId', { min: 1 }), body = requireObject(req.body);
    assert(['approve', 'reject'].includes(body.decision), 400, 'validation_error', 'Choose approve or reject.');
    const result = db.transaction(() => {
      const row = db.prepare('SELECT * FROM group_creation_requests WHERE id=?').get(id);
      assert(row && row.status === 'pending', 409, 'already_reviewed', 'This group request has already been reviewed or is unavailable.');
      const requester = db.prepare("SELECT 1 FROM users WHERE id=? AND role='faculty' AND disabled=0").get(row.faculty_id);
      assert(body.decision === 'reject' || requester, 400, 'faculty_unavailable', 'The requesting faculty account is unavailable.');
      let group = null;
      if (body.decision === 'approve') group = require('./group-creation').createGroup(db, req.user, body.group || JSON.parse(row.payload));
      db.prepare('UPDATE group_creation_requests SET status=?,reviewer_id=?,group_id=?,note=?,reviewed_at=? WHERE id=?').run(group ? 'approved' : 'rejected', req.user.id, group?.id || null, cleanString(body.note ?? '', 'note', { max: 500 }), now(), id);
      require('./admin').audit(db, { actorId: req.user.id, action: `group.request-${group ? 'approved' : 'rejected'}`, resource: 'group-request', resourceId: id });
      return { group, status: group ? 'approved' : 'rejected' };
    })();
    res.json(result);
  });
  router.get('/groups/:id', (req, res) => {
    const group = managedGroup(db, req.user, req.params.id);
    res.json({ group: { ...group, managerDepartment: managerDepartment(db,group) }, facultyIds: db.prepare('SELECT user_id FROM group_staff WHERE group_id=?').all(group.id).map(r => r.user_id), invitations: db.prepare('SELECT id,expires_at,revoked_at,created_at FROM group_invitations WHERE group_id=? ORDER BY id DESC LIMIT 50').all(group.id), requests: db.prepare("SELECT r.id,r.student_id,u.name,u.email,r.status,r.created_at FROM group_join_requests r JOIN users u ON u.id=r.student_id WHERE r.group_id=? AND r.status='pending' ORDER BY r.id").all(group.id) });
  });
  router.put('/groups/:id/managers', requireRole('admin'), (req, res) => {
    const group = managedGroup(db, req.user, req.params.id), body = requireObject(req.body);
    assert(!group.academic_level && ['custom', 'activity'].includes(group.kind), 400, 'automatic_group', 'Use class staff assignments for academic communities.');
    const settings = db.transaction(() => {
      const settings = saveGovernance(db, group, { category: group.category, sportsType: group.sports_type, sportsName: group.sports_name, studentManagerId: group.student_manager_id, ...body });
      require('./admin').audit(db, { actorId: req.user.id, action: 'group.managers', resource: 'group', resourceId: group.id, metadata: settings });
      return settings;
    })();
    res.json(settings);
  });
  router.post('/groups/:id/invitations', (req, res) => {
    const group = managedGroup(db, req.user, req.params.id);
    assert(!group.academic_level && ['custom', 'activity'].includes(group.kind), 400, 'automatic_group', 'Academic communities use automatic profile membership.');
    const days = cleanInteger(req.body?.days ?? 7, 'days', { min: 1, max: 30 });
    assert(db.prepare('SELECT count(*) n FROM group_invitations WHERE group_id=? AND revoked_at IS NULL AND expires_at>?').get(group.id,now()).n < 100, 429, 'invitation_limit', 'Revoke older invitations before creating more.');
    const token = crypto.randomBytes(32).toString('base64url'), expiresAt = new Date(Date.now() + days * 86400000).toISOString();
    const result = db.prepare('INSERT INTO group_invitations(group_id,creator_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)').run(group.id, req.user.id, hash(token), expiresAt, now());
    require('./admin').audit(db, { actorId: req.user.id, action: 'group.invitation-created', resource: 'group', resourceId: group.id });
    res.status(201).json({ id: Number(result.lastInsertRowid), token, expiresAt });
  });
  router.post('/invitations/:id/revoke', (req, res) => {
    const row = db.prepare('SELECT * FROM group_invitations WHERE id=?').get(cleanInteger(req.params.id, 'invitationId', { min: 1 }));
    assert(row, 404, 'not_found', 'Invitation not found.'); managedGroup(db, req.user, row.group_id);
    db.prepare('UPDATE group_invitations SET revoked_at=coalesce(revoked_at,?) WHERE id=?').run(now(), row.id);
    res.json({ ok: true });
  });
  function invitation(req) {
    const token = cleanString(req.params.token, 'token', { min: 43, max: 43 });
    const row = db.prepare('SELECT i.*,g.name FROM group_invitations i JOIN groups g ON g.id=i.group_id WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').get(hash(token), now());
    assert(row && canManage(db, { ...db.prepare('SELECT id,role FROM users WHERE id=? AND disabled=0').get(row.creator_id) }, row.group_id), 404, 'invitation_expired', 'This invitation has expired, was revoked, or its creator is no longer a group manager.');
    return row;
  }
  router.get('/invite/:token', requireRole('student'), (req, res) => {
    const row = invitation(req), group = db.prepare('SELECT * FROM groups WHERE id=?').get(row.group_id);
    assert(require('./academics').matchesProfile(db, req.user.id, group), 403, 'class_mismatch', 'This group does not match your profile.');
    const member = db.prepare('SELECT 1 FROM student_group_memberships WHERE group_id=? AND student_id=?').get(row.group_id, req.user.id);
    res.json({ name: row.name, expiresAt: row.expires_at, status: member ? 'member' : db.prepare('SELECT status FROM group_join_requests WHERE group_id=? AND student_id=?').get(row.group_id, req.user.id)?.status || 'new' });
  });
  router.post('/invite/:token', requireRole('student'), (req, res) => {
    const row = invitation(req);
    res.json({ status: requestJoin(db, req.user, row.group_id, row.id) });
  });
  router.get('/my-joins', requireRole('student'), (req, res) => res.json({ requests: db.prepare('SELECT group_id,status FROM group_join_requests WHERE student_id=?').all(req.user.id) }));
  router.post('/join-requests/:id/review', (req, res) => {
    const id = cleanInteger(req.params.id, 'requestId', { min: 1 }), body = requireObject(req.body);
    assert(['approve', 'reject'].includes(body.decision), 400, 'validation_error', 'Choose approve or reject.');
    db.transaction(() => {
      const row = db.prepare('SELECT * FROM group_join_requests WHERE id=?').get(id);
      assert(row && row.status === 'pending', 409, 'already_reviewed', 'This membership request has already been reviewed.');
      const group = managedGroup(db, req.user, row.group_id);
      if (body.decision === 'approve') {
        assert(db.prepare("SELECT 1 FROM users WHERE id=? AND role='student' AND disabled=0").get(row.student_id) && require('./academics').matchesProfile(db, row.student_id, group), 400, 'class_mismatch', 'The student is inactive or no longer matches this group.');
        if (row.via_invitation) {
          assert(row.invitation_id, 400, 'invitation_expired', 'The invitation is no longer available. Ask the student to use a new invitation.');
          const invite = db.prepare('SELECT * FROM group_invitations WHERE id=? AND revoked_at IS NULL AND expires_at>?').get(row.invitation_id, now());
          assert(invite && canManage(db, db.prepare('SELECT id,role FROM users WHERE id=? AND disabled=0').get(invite.creator_id) || {}, group.id), 400, 'invitation_expired', 'This invitation is no longer valid. Ask the student to use a new invitation.');
        }
        db.prepare("INSERT OR IGNORE INTO student_group_memberships(student_id,group_id,source,joined_at) VALUES(?,?,'faculty',?)").run(row.student_id, row.group_id, now());
      }
      db.prepare('UPDATE group_join_requests SET status=?,reviewer_id=?,reviewed_at=? WHERE id=?').run(body.decision === 'approve' ? 'approved' : 'rejected', req.user.id, now(), id);
      require('./admin').audit(db, { actorId: req.user.id, action: `group.join-${body.decision}`, resource: 'group', resourceId: group.id, metadata: { studentId: row.student_id } });
    })();
    res.json({ ok: true });
  });
  return router;
}
module.exports = { migrateGovernance, governanceRouter, canManage, facultyEligible, governanceSettings, saveGovernance, designations, requestJoin, managerDepartment };
