'use strict';
const assert = require('node:assert/strict');
const { it } = require('node:test');
const request = require('supertest');
const { createApplication } = require('../src/app');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDatabase, WORKSPACE_ROOT } = require('../src/db');

it('builds profile communities and enforces class staff assignments for subjects, uploads and downloads', async () => {
  const app = createApplication({ dbPath: ':memory:', envName: 'test', bcryptRounds: 4, disableOutboundNotifications: true });
  try {
    const student = request.agent(app.app), faculty = request.agent(app.app), admin = request.agent(app.app), outsider = request.agent(app.app);
    for (const [agent, email, password] of [[student, 'asha@demo.edu', 'Student123!'], [outsider, 'ravi@demo.edu', 'Student123!'], [faculty, 'faculty@demo.edu', 'Faculty123!'], [admin, 'admin@demo.edu', 'Admin123!']]) await agent.post('/api/auth/login').send({ email, password }).expect(200);
    const profile = { name: 'Asha Rao', register_number: 'IT01', department: ' it ', section: 'a', program: 'BTech', academic_year: '2026-27', bio: '' };
    await student.put('/api/platform/profile').send(profile).expect(200);
    const cls = (await student.get('/api/academics').expect(200)).body.classes[0];
    assert.equal(cls.department, 'IT'); assert.equal(cls.section, 'A');
    const groups = (await student.get('/api/groups').expect(200)).body.groups;
    const dept = groups.find(g => g.academicLevel === 'department'), section = groups.find(g => g.academicLevel === 'section');
    assert.equal(section.parentGroupId, dept.id); assert.equal(dept.parentGroupId, groups.find(g => g.kind === 'year').id);
    assert(dept.isMember && section.isMember);
    assert(!(await outsider.get('/api/groups').expect(200)).body.groups.some(g => g.id === section.id));
    await outsider.post('/api/memberships').send({ groupId: section.id, joined: true }).expect(403);
    await outsider.get(`/api/discussions/${section.id}/messages`).expect(404);
    await faculty.put(`/api/groups/${section.id}/members`).send({ studentIds: [] }).expect(403);
    await admin.patch(`/api/admin/groups/${section.id}`).send({ joinable: true }).expect(400);
    await student.get('/api/academics/administration').expect(403);
    await faculty.post('/api/academics/subjects').send({ classId: cls.id, name: 'Data Structures' }).expect(403);
    const fid = (await faculty.get('/api/auth/me')).body.user.id;
    await admin.put(`/api/academics/classes/${cls.id}/staff`).send({ facultyIds: [fid] }).expect(200);
    const sid = (await faculty.post('/api/academics/subjects').send({ classId: cls.id, name: 'Data Structures' }).expect(201)).body.id;
    await student.post('/api/academics/subjects').send({ classId: cls.id, name: 'Spoofed' }).expect(403);
    await faculty.post('/api/academics/subjects').send({ classId: cls.id, name: 'data structures' }).expect(409);
    const file = { title: 'Unit 1 notes', name: 'notes.pdf', data: Buffer.from('%PDF-1.4\nClass notes\n%%EOF').toString('base64') };
    await faculty.post(`/api/academics/subjects/${sid}/materials`).send({ ...file, name: 'fake.pdf', data: Buffer.from('not a pdf').toString('base64') }).expect(400);
    const mid = (await faculty.post(`/api/academics/subjects/${sid}/materials`).send(file).expect(201)).body.id;
    const url = `/api/academics/materials/${mid}/download`;
    await student.get(url).expect(200).expect('Content-Type', /application\/pdf/).expect('Content-Disposition', /attachment/).expect('Cache-Control', 'private, no-store');
    await outsider.get(url).expect(404);
    await request(app.app).get(url).expect(401);
    assert.equal((await student.get('/api/academics')).body.subjects[0].materials[0].title, file.title);
    await admin.put(`/api/academics/classes/${cls.id}/staff`).send({ facultyIds: [] }).expect(200);
    await faculty.post(`/api/academics/subjects/${sid}/materials`).send(file).expect(403);
    await faculty.get(url).expect(404);
    await student.put('/api/platform/profile').send({ ...profile, department: 'ECE' }).expect(200);
    await student.get(url).expect(404);
    assert(!(await student.get('/api/memberships')).body.groupIds.includes(section.id));
    assert.equal((await student.get('/api/academics')).body.subjects.length, 0);
    await admin.post('/api/academics/classes').send({ year: 2, department: 'EEE', section: 'B' }).expect(201);
    await faculty.post('/api/academics/classes').send({ year: 2, department: 'EEE', section: 'B' }).expect(403);
  } finally { app.close(); }
});

it('preserves academic classes, staff assignments and file content across database restarts', () => {
  const filename = path.join(WORKSPACE_ROOT, 'data', `academic-test-${crypto.randomUUID()}.db`);
  let db;
  try {
    db = openDatabase({ filename, bcryptRounds: 4 });
    const cls = require('../src/academics').ensureClass(db, 2, 'IT', 'A');
    const facultyId = db.prepare("SELECT id FROM users WHERE email='faculty@demo.edu'").get().id;
    db.prepare('INSERT INTO teaching_assignments VALUES(?,?)').run(cls.id, facultyId);
    const sid = db.prepare('INSERT INTO academic_subjects(class_id,name,faculty_id,created_at) VALUES(?,?,?,?)').run(cls.id, 'Networks', facultyId, new Date().toISOString()).lastInsertRowid;
    const bytes = Buffer.from('%PDF-1.4\nSaved notes\n%%EOF');
    db.prepare('INSERT INTO academic_materials VALUES(?,?,?,?,?,?,?,?,?)').run('persistent-file', sid, facultyId, 'Unit 1', 'notes.pdf', 'application/pdf', bytes.length, bytes, new Date().toISOString());
    db.close(); db = openDatabase({ filename, seed: false });
    assert.equal(require('../src/academics').ensureClass(db, 2, 'it', 'a').id, cls.id);
    assert.equal(db.prepare('SELECT count(*) n FROM academic_classes').get().n, 1);
    assert.equal(db.prepare('SELECT faculty_id FROM teaching_assignments').get().faculty_id, facultyId);
    assert.deepEqual(db.prepare('SELECT content FROM academic_materials').get().content, bytes);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally { if (db?.open) db.close(); if (fs.existsSync(filename)) fs.unlinkSync(filename); }
});
