'use strict';
const assert = require('node:assert/strict');
const { before, after, it } = require('node:test');
const request = require('supertest');
const Database = require('better-sqlite3');
const { createApplication } = require('../src/app');
const { migrateAdmin } = require('../src/admin-migration');
let context, admin, faculty, student;
before(async () => {
  context = createApplication({ dbPath: ':memory:', envName: 'test', bcryptRounds: 4, disableOutboundNotifications: true });
  [admin, faculty, student] = Array.from({ length: 3 }, () => request.agent(context.app));
  for (const [agent, email, password] of [[admin, 'admin@demo.edu', 'Admin123!'], [faculty, 'faculty@demo.edu', 'Faculty123!'], [student, 'asha@demo.edu', 'Student123!']]) {
    await agent.post('/api/auth/login').send({ email, password }).expect(200);
  }
});
after(() => context.close());

it('admin migration preserves existing identities, foreign keys, indexes, and repeated runs', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT UNIQUE,password_hash TEXT NOT NULL,role TEXT CHECK(role IN ('faculty', 'student')),year INTEGER,created_at TEXT);
      CREATE INDEX idx_user_name ON users(name);
      CREATE TABLE memberships(user_id INTEGER REFERENCES users(id),name TEXT);
      INSERT INTO users VALUES(42,'Existing student','existing@example.edu','original-hash','student',2,'2025-01-01');
      INSERT INTO memberships VALUES(42,'Robotics');`);
    migrateAdmin(db); migrateAdmin(db);
    assert.equal(db.prepare('SELECT password_hash FROM users WHERE id=42').get().password_hash, 'original-hash');
    assert.equal(db.prepare('SELECT * FROM memberships').get().user_id, 42);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert(db.prepare("SELECT name FROM sqlite_master WHERE name='idx_user_name'").get());
    db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES('Admin','admin@example.edu','hash','admin')").run();
    assert.equal(db.prepare('SELECT disabled FROM users WHERE id=42').get().disabled, 0);
  } finally { db.close(); }
});

it('protects administration from students, faculty, and anonymous requests', async () => {
  for (const route of ['stats', 'users', 'groups', 'reports', 'audit', 'config', 'notifications']) {
    await request(context.app).get(`/api/admin/${route}`).expect(401);
    await faculty.get(`/api/admin/${route}`).expect(403);
    await student.get(`/api/admin/${route}`).expect(403);
    await admin.get(`/api/admin/${route}`).expect(200);
  }
  const account = context.db.prepare("SELECT id FROM users WHERE role='admin'").get();
  await admin.patch(`/api/admin/users/${account.id}`).send({ disabled: true }).expect(400);
});

it('creates faculty with hashed credentials, revokes disabled sessions, and records safe audit entries', async () => {
  const response = await admin.post('/api/admin/users').send({ name: 'New Professor', email: 'new@example.edu', password: 'Secure123!', role: 'faculty' }).expect(201);
  const id = response.body.user.id;
  assert.equal(response.body.user.role, 'faculty');
  assert.equal(response.body.user.password_hash, undefined);
  const stored = context.db.prepare('SELECT password_hash FROM users WHERE id=?').get(id);
  assert.notEqual(stored.password_hash, 'Secure123!');
  const professor = request.agent(context.app);
  await professor.post('/api/auth/login').send({ email: 'new@example.edu', password: 'Secure123!' }).expect(200);
  await admin.patch(`/api/admin/users/${id}`).send({ disabled: true }).expect(200);
  await professor.get('/api/circulars').expect(401);
  await professor.post('/api/auth/login').send({ email: 'new@example.edu', password: 'Secure123!' }).expect(401);
  const audit = (await admin.get('/api/admin/audit').expect(200)).body.entries;
  assert(audit.some((entry) => entry.action === 'user.updated' && entry.resourceId === String(id)));
  assert(!JSON.stringify(audit).includes('Secure123!'));
  await admin.patch(`/api/admin/users/${id}`).send({ role: 'admin' }).expect(400);
});

it('manages custom membership and preserves automatic year groups', async () => {
  const response = await admin.post('/api/admin/users').send({ name: 'New Student', email: 'learner@example.edu', password: 'Secure123!', role: 'student', year: 2 }).expect(201);
  const id = response.body.user.id;
  const group = (await admin.post('/api/admin/groups').send({ name: 'Design Society', joinable: true }).expect(201)).body.group;
  await admin.put(`/api/admin/groups/${group.id}/members/${id}`).expect(200);
  assert((await admin.get(`/api/admin/groups/${group.id}/members`).expect(200)).body.members.some((member) => member.id === id));
  await admin.patch(`/api/admin/users/${id}`).send({ year: 3 }).expect(200);
  const yearGroups = context.db.prepare("SELECT g.year FROM groups g JOIN student_group_memberships m ON g.id=m.group_id WHERE m.student_id=? AND g.kind='year'").all(id);
  assert.deepEqual(yearGroups, [{ year: 3 }]);
  const automatic = context.db.prepare("SELECT id FROM groups WHERE kind='year' LIMIT 1").get();
  await admin.delete(`/api/admin/groups/${automatic.id}/members/${id}`).expect(400);
  await admin.delete(`/api/admin/groups/${group.id}/members/${id}`).expect(200);
});

it('accepts private abuse reports and moderates content with an audit trail', async () => {
  const { body: { id } } = await student.post('/api/posts').send({ caption: 'A reported campus update' }).expect(201);
  const report = (await faculty.post('/api/reports').send({ targetType: 'post', targetId: id, reason: 'Please review this content.' }).expect(201)).body;
  const repeated = (await faculty.post('/api/reports').send({ targetType: 'post', targetId: id, reason: 'Please review this content.' }).expect(200)).body;
  assert.equal(repeated.id, report.id);
  await student.post(`/api/admin/reports/${report.id}/resolve`).send({ action: 'remove' }).expect(403);
  await admin.post(`/api/admin/reports/${report.id}/resolve`).send({ action: 'remove', note: 'Removed after review.' }).expect(200);
  assert.equal(context.db.prepare('SELECT id FROM campus_posts WHERE id=?').get(id), undefined);
  const saved = context.db.prepare('SELECT * FROM campus_reports WHERE id=?').get(report.id);
  assert.equal(saved.status, 'removed');
  assert.equal(saved.content_snapshot, 'A reported campus update');
  await admin.post(`/api/admin/reports/${report.id}/resolve`).send({ action: 'remove' }).expect(409);
});

it('validates public college settings and closes registration when configured', async () => {
  await admin.put('/api/admin/config').send({ sessionSecret: 'do-not-accept' }).expect(400);
  await admin.put('/api/admin/config').send({ collegeName: 'Test College', registrationOpen: false }).expect(200);
  const config = (await request(context.app).get('/api/config').expect(200)).body;
  assert.equal(config.collegeName, 'Test College');
  assert.equal(config.registrationOpen, false);
  await request(context.app).post('/api/auth/register').send({ name: 'Closed Applicant', email: 'closed@example.edu', password: 'Secure123!', year: 1 }).expect(403);
});
