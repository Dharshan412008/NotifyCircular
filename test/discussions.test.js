'use strict';
const assert = require('node:assert/strict');
const { it } = require('node:test');
const request = require('supertest');
const { createApplication } = require('../src/app');

async function setup(run) {
  const app = createApplication({ dbPath: ':memory:', envName: 'test', bcryptRounds: 4, disableOutboundNotifications: true });
  try {
    const faculty = request.agent(app.app), asha = request.agent(app.app), ravi = request.agent(app.app);
    for (const [agent, email, password] of [[faculty, 'faculty@demo.edu', 'Faculty123!'], [asha, 'asha@demo.edu', 'Student123!'], [ravi, 'ravi@demo.edu', 'Student123!']]) await agent.post('/api/auth/login').send({ email, password }).expect(200);
    const group = app.db.prepare("SELECT id FROM groups WHERE name='Sports Group'").get().id;
    const broadcast = app.db.prepare("SELECT id FROM groups WHERE name='Whole College'").get().id;
    const ashaId = app.db.prepare("SELECT id FROM users WHERE email='asha@demo.edu'").get().id;
    await run({ app, faculty, asha, ravi, group, broadcast, ashaId });
  } finally { app.close(); }
}

it('restricts discussion discovery and every mutation to current members or staff', () => setup(async ({ app, faculty, asha, ravi, group, ashaId }) => {
  await request(app.app).get('/api/discussions').expect(401);
  assert((await asha.get('/api/discussions').expect(200)).body.channels.some((item) => item.id === group));
  assert(!(await ravi.get('/api/discussions').expect(200)).body.channels.some((item) => item.id === group));
  const id = (await faculty.post(`/api/discussions/${group}/messages`).send({ text: 'Practice starts at four.' }).expect(201)).body.id;
  await ravi.get(`/api/discussions/${group}/messages`).expect(404);
  await ravi.post(`/api/discussions/${group}/messages`).send({ text: 'Not a member' }).expect(404);
  await ravi.put(`/api/discussions/${group}/messages/${id}/reactions`).send({ emoji: '👍', active: true }).expect(404);
  await ravi.put(`/api/discussions/${group}/read`).send({ messageId: id }).expect(404);
  await asha.delete(`/api/discussions/${group}/messages/${id}`).expect(403);
  app.db.prepare('DELETE FROM student_group_memberships WHERE student_id=? AND group_id=?').run(ashaId, group);
  await asha.get(`/api/discussions/${group}/messages`).expect(404);
  await asha.post(`/api/discussions/${group}/messages`).send({ text: 'Revoked' }).expect(404);
  await faculty.get(`/api/discussions/${group}/messages`).expect(200);
}));

it('keeps replies inside their channel and reactions idempotent and owned by the reacting user', () => setup(async ({ faculty, asha, group, broadcast }) => {
  const root = (await faculty.post(`/api/discussions/${group}/messages`).send({ text: 'Bring your college ID.' }).expect(201)).body.id;
  await asha.post(`/api/discussions/${broadcast}/messages`).send({ text: 'Invalid cross-channel quote', replyTo: root }).expect(400);
  await asha.post(`/api/discussions/${group}/messages`).send({ text: 'Thank you!', replyTo: root }).expect(201);
  for (let i = 0; i < 2; i++) await asha.put(`/api/discussions/${group}/messages/${root}/reactions`).send({ emoji: '👍', active: true }).expect(200);
  let rows = (await faculty.get(`/api/discussions/${group}/messages`).expect(200)).body.messages;
  assert.equal(rows[0].replyBody, 'Bring your college ID.');
  assert.equal(rows[1].reactions[0].count, 1);
  assert.equal(rows[1].reactions[0].mine, 0);
  await faculty.put(`/api/discussions/${group}/messages/${root}/reactions`).send({ emoji: '👍', active: false }).expect(200);
  await asha.put(`/api/discussions/${broadcast}/messages/${root}/reactions`).send({ emoji: '👍', active: true }).expect(404);
  await asha.put(`/api/discussions/${group}/messages/${root}/reactions`).send({ emoji: 'unsupported', active: true }).expect(400);
  await asha.put(`/api/discussions/${group}/messages/${root}/reactions`).send({ emoji: '👍', active: false }).expect(200);
  rows = (await faculty.get(`/api/discussions/${group}/messages`).expect(200)).body.messages;
  assert.deepEqual(rows[1].reactions, []);
  await asha.post(`/api/discussions/${group}/messages`).send({ text: '   ' }).expect(400);
  await asha.post(`/api/discussions/${group}/messages`).send({ text: 'a'.repeat(2001) }).expect(400);
}));

it('allows staff pins and moderation, scrubs removed quotes, and filters pinned messages', () => setup(async ({ faculty, asha, group }) => {
  const id = (await asha.post(`/api/discussions/${group}/messages`).send({ text: 'Sensitive original text' }).expect(201)).body.id;
  await faculty.post(`/api/discussions/${group}/messages`).send({ text: 'Reply remains', replyTo: id }).expect(201);
  await asha.put(`/api/discussions/${group}/messages/${id}/pin`).send({ pinned: true }).expect(403);
  await faculty.put(`/api/discussions/${group}/messages/${id}/pin`).send({ pinned: true }).expect(200);
  const pinned = (await asha.get(`/api/discussions/${group}/messages?pinned=true`).expect(200)).body.messages;
  assert.equal(pinned.length, 1); assert.equal(pinned[0].id, id);
  await faculty.delete(`/api/discussions/${group}/messages/${id}`).expect(200);
  const rows = (await asha.get(`/api/discussions/${group}/messages`).expect(200)).body.messages;
  assert.equal(rows[0].replyBody, 'Message removed'); assert.equal(rows[1].body, 'Message removed');
  assert.equal((await asha.get(`/api/discussions/${group}/messages?pinned=true`).expect(200)).body.messages.length, 0);
  await asha.post(`/api/discussions/${group}/messages`).send({ text: 'Invalid removed quote', replyTo: id }).expect(400);
}));

it('paginates and searches the full history and tracks unread messages independently without going backwards', () => setup(async ({ app, faculty, asha, group, broadcast, ashaId }) => {
  const facultyId = app.db.prepare("SELECT id FROM users WHERE email='faculty@demo.edu'").get().id;
  const insert = app.db.prepare('INSERT INTO discussion_messages(group_id,user_id,body,created_at) VALUES(?,?,?,?)');
  for (let i = 0; i < 45; i++) insert.run(group, facultyId, `Update ${i}`, new Date().toISOString());
  const page = (await asha.get(`/api/discussions/${group}/messages`).expect(200)).body;
  assert.equal(page.messages.length, 40); assert(page.nextCursor);
  const older = (await asha.get(`/api/discussions/${group}/messages?before=${page.nextCursor}`).expect(200)).body;
  assert.equal(older.messages.length, 5); assert.equal(older.nextCursor, null);
  assert.equal((await asha.get(`/api/discussions/${group}/messages?q=Update%200`).expect(200)).body.messages.length, 1);
  const latest = page.messages[0].id;
  await asha.put(`/api/discussions/${broadcast}/read`).send({ messageId: latest }).expect(400);
  await asha.put(`/api/discussions/${group}/read`).send({ messageId: latest }).expect(200);
  await asha.put(`/api/discussions/${group}/read`).send({ messageId: older.messages[0].id }).expect(200);
  assert.equal((await asha.get('/api/discussions').expect(200)).body.channels.find((item) => item.id === group).unread, 0);
  insert.run(group, ashaId, 'My own update', new Date().toISOString());
  assert.equal((await asha.get('/api/discussions').expect(200)).body.channels.find((item) => item.id === group).unread, 0);
  assert.equal((await faculty.get('/api/discussions').expect(200)).body.channels.find((item) => item.id === group).unread, 1);
  require('../src/discussions').discussionsRouter(app.db);
  assert.equal((await asha.get(`/api/discussions/${group}/messages`).expect(200)).body.messages[0].body, 'My own update');
}));
