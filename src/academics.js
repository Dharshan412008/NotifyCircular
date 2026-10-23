'use strict';
const express = require('express');
const crypto = require('node:crypto');
const { requireAuth, requireRole } = require('./auth');
const { assert } = require('./errors');
const { cleanString, cleanInteger, requireObject } = require('./validation');
const now = () => new Date().toISOString();
const normalized = (value) => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();

function migrateAcademics(db) {
  if (!db.prepare('PRAGMA table_info(groups)').all().some(c => c.name === 'academic_level')) db.exec("ALTER TABLE groups ADD COLUMN academic_level TEXT NOT NULL DEFAULT ''");
  db.exec(`CREATE TABLE IF NOT EXISTS academic_classes(id INTEGER PRIMARY KEY,year INTEGER NOT NULL CHECK(year BETWEEN 1 AND 4),department TEXT NOT NULL,section TEXT NOT NULL,group_id INTEGER NOT NULL UNIQUE REFERENCES groups(id),UNIQUE(year,department,section));
    CREATE TABLE IF NOT EXISTS teaching_assignments(class_id INTEGER NOT NULL REFERENCES academic_classes(id) ON DELETE CASCADE,faculty_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(class_id,faculty_id));
    CREATE TABLE IF NOT EXISTS academic_subjects(id INTEGER PRIMARY KEY,class_id INTEGER NOT NULL REFERENCES academic_classes(id),name TEXT NOT NULL,faculty_id INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,UNIQUE(class_id,name));
    CREATE TABLE IF NOT EXISTS academic_materials(id TEXT PRIMARY KEY,subject_id INTEGER NOT NULL REFERENCES academic_subjects(id) ON DELETE CASCADE,faculty_id INTEGER NOT NULL REFERENCES users(id),title TEXT NOT NULL,name TEXT NOT NULL,mime_type TEXT NOT NULL,size INTEGER NOT NULL,content BLOB NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS academic_material_subject ON academic_materials(subject_id,created_at);
    CREATE INDEX IF NOT EXISTS academic_material_uploader ON academic_materials(faculty_id);`);
}

function ensureClass(db, year, department, section) {
  department = normalized(department); section = normalized(section);
  if (![1, 2, 3, 4].includes(year) || !department || !section) return null;
  const existing = db.prepare('SELECT * FROM academic_classes WHERE year=? AND department=? AND section=?').get(year, department, section);
  if (existing) return existing;
  return db.transaction(() => {
    const parent = db.prepare("SELECT id FROM groups WHERE kind='year' AND year=? ORDER BY id LIMIT 1").get(year);
    const add = (name, level, parentId, classSection) => {
      const slug = `academic-${crypto.randomUUID()}`;
      // Custom communities may already use the human-readable academic name.
      if (db.prepare('SELECT 1 FROM groups WHERE name=?').get(name)) name += ` (${slug.slice(-8)})`;
      const result = db.prepare(`INSERT INTO groups(slug,name,description,icon,kind,joinable,year,department,section,parent_group_id,academic_level,created_at) VALUES(?,?,?,'GR','custom',0,?,?,?,?,?,?)`).run(slug, name, 'Assigned from your academic profile', year, department, classSection, parentId, level, now());
      return Number(result.lastInsertRowid);
    };
    let dept = db.prepare("SELECT id FROM groups WHERE academic_level='department' AND year=? AND department=?").get(year, department);
    if (!dept) dept = { id: add(`Year ${year} · ${department}`, 'department', parent?.id || null, '') };
    const groupId = add(`Year ${year} · ${department} · ${section}`, 'section', dept.id, section);
    const result = db.prepare('INSERT INTO academic_classes(year,department,section,group_id) VALUES(?,?,?,?)').run(year, department, section, groupId);
    return db.prepare('SELECT * FROM academic_classes WHERE id=?').get(result.lastInsertRowid);
  })();
}

function profileMatches(db, p, group, seen = new Set()) {
  if (!p || !group || seen.has(group.id)) return false;
  if (group.id) seen.add(group.id);
  if (group.year && p.year !== group.year || group.department && normalized(p.department) !== normalized(group.department) || group.section && normalized(p.section) !== normalized(group.section)) return false;
  return !group.parent_group_id || profileMatches(db, p, db.prepare('SELECT * FROM groups WHERE id=?').get(group.parent_group_id), seen);
}
function matchesProfile(db, studentId, group) {
  const p = db.prepare('SELECT u.year,p.department,p.section FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=?').get(studentId);
  return profileMatches(db, p, group);
}

function syncStudent(db, id) {
  const p = db.prepare("SELECT u.year,p.department,p.section FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=? AND u.role='student'").get(id);
  if (!p) return;
  db.transaction(() => {
    ensureClass(db, p.year, p.department, p.section);
    const groups = db.prepare("SELECT * FROM groups WHERE year IS NOT NULL OR department!='' OR section!='' OR parent_group_id IS NOT NULL").all();
    const remove = db.prepare('DELETE FROM student_group_memberships WHERE student_id=? AND group_id=?');
    const add = db.prepare("INSERT OR IGNORE INTO student_group_memberships(student_id,group_id,source,joined_at) VALUES(?,?,'automatic',?)");
    for (const group of groups) {
      if (!profileMatches(db, p, group)) remove.run(id, group.id);
      else if (group.academic_level || group.kind === 'year') add.run(id, group.id, now());
    }
  })();
}

function classAccess(db, user, id) {
  const cls = db.prepare('SELECT * FROM academic_classes WHERE id=?').get(id);
  if (!cls) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'faculty') {
    const profile = db.prepare('SELECT department FROM user_profiles WHERE user_id=?').get(user.id);
    return normalized(profile?.department) === normalized(cls.department) && Boolean(db.prepare('SELECT 1 FROM teaching_assignments WHERE class_id=? AND faculty_id=?').get(id, user.id));
  }
  return matchesProfile(db, user.id, cls);
}

function academicsRouter(db) {
  const router = express.Router();
  router.use(requireAuth);
  router.get('/', (req, res) => {
    const classes = db.prepare('SELECT * FROM academic_classes ORDER BY year,department,section').all().filter(c => classAccess(db, req.user, c.id));
    const subjects = classes.flatMap(c => db.prepare('SELECT s.*,u.name faculty_name FROM academic_subjects s JOIN users u ON u.id=s.faculty_id WHERE class_id=? ORDER BY s.name').all(c.id).map(s => ({ ...s, materials: db.prepare('SELECT id,title,name,size,created_at,faculty_id FROM academic_materials WHERE subject_id=? ORDER BY created_at DESC').all(s.id) })));
    res.json({ classes, subjects });
  });
  router.get('/administration', requireRole('admin'), (_req, res) => {
    const faculty = db.prepare("SELECT u.id,u.name,u.email,coalesce(p.department,'') department FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.role='faculty' AND u.disabled=0 ORDER BY u.name").all();
    const classes = db.prepare('SELECT * FROM academic_classes ORDER BY year,department,section').all().map(cls => ({ ...cls, eligibleFacultyIds: faculty.filter(f => normalized(f.department) === normalized(cls.department)).map(f => f.id) }));
    const assignments = db.prepare('SELECT * FROM teaching_assignments').all().filter(a => classes.some(c => c.id === a.class_id && c.eligibleFacultyIds.includes(a.faculty_id)));
    res.json({ classes, faculty, assignments });
  });
  router.post('/classes', requireRole('admin'), (req, res) => {
    const body = requireObject(req.body);
    const cls = ensureClass(db, cleanInteger(body.year, 'year', { min: 1, max: 4 }), cleanString(body.department, 'department', { min: 1, max: 80 }), cleanString(body.section, 'section', { min: 1, max: 30 }));
    res.status(201).json({ class: cls });
  });
  router.put('/classes/:id/staff', requireRole('admin'), (req, res) => {
    const id = cleanInteger(req.params.id, 'id', { min: 1 });
    const body = requireObject(req.body);
    const cls = db.prepare('SELECT * FROM academic_classes WHERE id=?').get(id);
    assert(cls, 404, 'not_found', 'Class not found.');
    assert(Array.isArray(body.facultyIds) && body.facultyIds.length <= 100, 400, 'validation_error', 'Choose assigned staff.');
    const ids = [...new Set(body.facultyIds.map(v => cleanInteger(v, 'facultyId', { min: 1 })))];
    assert(ids.every(fid => db.prepare("SELECT 1 FROM users WHERE id=? AND role='faculty' AND disabled=0").get(fid)), 400, 'validation_error', 'Choose active faculty accounts.');
    assert(ids.every(fid => normalized(db.prepare('SELECT department FROM user_profiles WHERE user_id=?').get(fid)?.department) === normalized(cls.department)), 400, 'department_mismatch', 'Choose staff from the same department as this class. Staff must complete their department in Account settings.');
    db.transaction(() => {
      db.prepare('DELETE FROM teaching_assignments WHERE class_id=?').run(id);
      for (const fid of ids) db.prepare('INSERT INTO teaching_assignments VALUES(?,?)').run(id, fid);
      require('./admin').audit(db, { actorId: req.user.id, action: 'class.staff-assigned', resource: 'class', resourceId: id, metadata: { facultyIds: ids } });
    })();
    res.json({ ok: true });
  });
  router.post('/subjects', requireRole('faculty'), (req, res) => {
    const body = requireObject(req.body), id = cleanInteger(body.classId, 'classId', { min: 1 });
    assert(classAccess(db, req.user, id), 403, 'class_forbidden', 'An administrator must assign you to this class first.');
    const name = cleanString(body.name, 'name', { min: 2, max: 120 });
    assert(!db.prepare('SELECT 1 FROM academic_subjects WHERE class_id=? AND lower(name)=lower(?)').get(id, name), 409, 'subject_exists', 'This subject already exists in this class.');
    const result = db.prepare('INSERT INTO academic_subjects(class_id,name,faculty_id,created_at) VALUES(?,?,?,?)').run(id, name, req.user.id, now());
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });
  router.post('/subjects/:id/materials', requireRole('faculty'), express.json({ limit: '8mb' }), (req, res) => {
    const subject = db.prepare('SELECT * FROM academic_subjects WHERE id=?').get(cleanInteger(req.params.id, 'id', { min: 1 }));
    assert(subject && classAccess(db, req.user, subject.class_id), 403, 'class_forbidden', 'You can upload only to your assigned classes.');
    const body = requireObject(req.body), title = cleanString(body.title, 'title', { min: 2, max: 160 });
    const file = require('./circular-tools').validateAttachment(body, 5 * 1024 * 1024);
    const stored = db.prepare('SELECT coalesce(sum(size),0) total FROM academic_materials WHERE faculty_id=?').get(req.user.id).total;
    assert(stored + file.content.length <= 200 * 1024 * 1024, 413, 'storage_limit', 'Your 200 MB material storage limit has been reached.');
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO academic_materials VALUES(?,?,?,?,?,?,?,?,?)').run(id, subject.id, req.user.id, title, file.name, file.mimeType, file.content.length, file.content, now());
    res.status(201).json({ id });
  });
  router.get('/materials/:id/download', (req, res) => {
    const file = db.prepare('SELECT m.*,s.class_id FROM academic_materials m JOIN academic_subjects s ON s.id=m.subject_id WHERE m.id=?').get(req.params.id);
    assert(file && classAccess(db, req.user, file.class_id), 404, 'not_found', 'Material is not available for your class.');
    res.set('Cache-Control', 'private, no-store').set('X-Content-Type-Options', 'nosniff').attachment(file.name).type(file.mime_type).send(file.content);
  });
  router.delete('/materials/:id', requireRole('faculty'), (req, res) => {
    const file = db.prepare('SELECT m.*,s.class_id FROM academic_materials m JOIN academic_subjects s ON s.id=m.subject_id WHERE m.id=?').get(req.params.id);
    assert(file && file.faculty_id === req.user.id && classAccess(db, req.user, file.class_id), 403, 'forbidden', 'Only the uploader assigned to this class can remove this material.');
    db.prepare('DELETE FROM academic_materials WHERE id=?').run(file.id);
    res.json({ ok: true });
  });
  return router;
}
module.exports = { migrateAcademics, ensureClass, syncStudent, matchesProfile, classAccess, academicsRouter };
