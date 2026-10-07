'use strict';
const assert = require('node:assert/strict');
const { before, after, it } = require('node:test');
const request = require('supertest');
const { createApplication } = require('../src/app');
let context, asha, ravi, faculty, ashaId;
before(async () => {
  context = createApplication({ dbPath: ':memory:', envName: 'test', bcryptRounds: 4, disableOutboundNotifications: true });
  [asha, ravi, faculty] = Array.from({ length: 3 }, () => request.agent(context.app));
  for (const [agent, email, password] of [[asha, 'asha@demo.edu', 'Student123!'], [ravi, 'ravi@demo.edu', 'Student123!'], [faculty, 'faculty@demo.edu', 'Faculty123!']]) {
    const result = await agent.post('/api/auth/login').send({ email, password }).expect(200);
    if (agent === asha) ashaId = result.body.user.id;
  }
});
after(() => context.close());

it('searches and saves only authorized circulars and keeps collections private', async () => {
  const hidden = context.db.prepare("SELECT c.id FROM circulars c JOIN circular_targets t ON t.circular_id=c.id JOIN groups g ON g.id=t.group_id WHERE g.slug='final-year'").get();
  await asha.put(`/api/platform/circulars/${hidden.id}/save`).expect(404);
  const search = (await asha.get('/api/platform/search?q=placement').expect(200)).body.results;
  assert(!search.some((item) => item.id === `c-${hidden.id}`));
  const allowed = (await asha.get('/api/platform/circulars').expect(200)).body.circulars[0];
  await asha.put(`/api/platform/circulars/${allowed.id}/save`).expect(200);
  await asha.put(`/api/platform/circulars/${allowed.id}/save`).expect(200);
  const collection = (await asha.get('/api/platform/circulars?saved=true').expect(200)).body.circulars;
  assert.equal(collection.length, 1);
  assert.equal(collection[0].id, allowed.id);
  assert.equal((await ravi.get('/api/platform/circulars?saved=true').expect(200)).body.circulars.length, 0);
  await asha.delete(`/api/platform/circulars/${allowed.id}/save`).expect(200);
  assert.equal((await asha.get('/api/platform/circulars?saved=true').expect(200)).body.circulars.length, 0);
});

it('persists validated profiles and computes a deduplicated filtered audience', async () => {
  const profile = { name: 'Asha Rao', register_number: 'CS101', department: 'Computing', program: 'BTech', section: 'A', academic_year: '2026–27', bio: 'Robotics and design' };
  await asha.put('/api/platform/profile').send({ ...profile, role: 'admin' }).expect(200);
  const saved = (await asha.get('/api/platform/profile').expect(200)).body.profile;
  assert.equal(saved.department, 'Computing');
  assert.equal(saved.role, 'student');
  await asha.put('/api/platform/profile').send({ ...profile, bio: 'x'.repeat(501) }).expect(400);
  const groupIds = context.db.prepare("SELECT id FROM groups WHERE slug IN ('first-year','whole-college')").all().map((row) => row.id);
  const audience = (await faculty.post('/api/platform/audience-preview').send({ groupIds, department: 'Computing', year: 1, section: 'A' }).expect(200)).body;
  assert.equal(audience.count, 1);
  assert.deepEqual(audience.members.map((member) => member.id), [ashaId]);
  const all = (await faculty.post('/api/platform/audience-preview').send({ groupIds }).expect(200)).body;
  assert.equal(all.count, 2);
  await asha.post('/api/platform/audience-preview').send({ groupIds }).expect(403);
});

it('keeps notification read state private and does not recreate cleared notifications', async () => {
  const list = (await asha.get('/api/platform/notifications').expect(200)).body;
  assert(list.unread > 0);
  const firstId = list.notifications[0].id;
  await ravi.post('/api/platform/notifications/read').send({ id: firstId }).expect(200);
  assert.equal(context.db.prepare('SELECT read_at FROM platform_notifications WHERE id=?').get(firstId).read_at, null);
  await asha.post('/api/platform/notifications/read').send({}).expect(200);
  assert.equal((await asha.get('/api/platform/notifications').expect(200)).body.unread, 0);
  await asha.delete('/api/platform/notifications').expect(200);
  assert.equal((await asha.get('/api/platform/notifications').expect(200)).body.notifications.length, 0);
  const preferences = { circular: false, event: true, social: false, email: false, digest: 'daily' };
  await asha.put('/api/platform/preferences').send(preferences).expect(200);
  assert.deepEqual((await asha.get('/api/platform/preferences').expect(200)).body.preferences, preferences);
  await asha.put('/api/platform/preferences').send({ ...preferences, email: 'yes' }).expect(400);
});

it('removes old private summaries from notification and overview responses after membership removal', async () => {
  const db = context.db;
  const teacher = db.prepare("SELECT id FROM users WHERE email='faculty@demo.edu'").get();
  const group = db.prepare("INSERT INTO groups(slug,name,kind,created_at) VALUES('private-lab','Private Lab','custom',?)").run(new Date().toISOString()).lastInsertRowid;
  db.prepare("INSERT INTO student_group_memberships(student_id,group_id,source,joined_at) VALUES(?,?,'faculty',?)").run(ashaId, group, new Date().toISOString());
  const id = Number(db.prepare("INSERT INTO circulars(faculty_id,text,summary,created_at) VALUES(?,'Private lab password handout','Private lab password handout',?)").run(teacher.id, new Date().toISOString()).lastInsertRowid);
  db.prepare('INSERT INTO circular_targets(circular_id,group_id) VALUES(?,?)').run(id, group);
  await asha.put('/api/platform/preferences').send({ circular: true, event: true, social: true, email: true, digest: 'instant' }).expect(200);
  const before = (await asha.get('/api/platform/notifications').expect(200)).body.notifications;
  assert(before.some((item) => item.circular_id === id));
  db.prepare('DELETE FROM student_group_memberships WHERE student_id=? AND group_id=?').run(ashaId, group);
  assert(!(await asha.get('/api/platform/notifications').expect(200)).body.notifications.some((item) => item.circular_id === id));
  assert(!JSON.stringify((await asha.get('/api/platform/overview').expect(200)).body).includes('Private lab password handout'));
});
