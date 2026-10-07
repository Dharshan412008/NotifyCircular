'use strict';
const assert = require('node:assert/strict');
const { before, after, it } = require('node:test');
const request = require('supertest');
const { createApplication } = require('../src/app');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { openDatabase, WORKSPACE_ROOT } = require('../src/db');
let context, asha, ravi, faculty;
before(async () => {
  context = createApplication({ dbPath: ':memory:', envName: 'test', bcryptRounds: 4, disableOutboundNotifications: true });
  [asha, ravi, faculty] = Array.from({ length: 3 }, () => request.agent(context.app));
  for (const [agent, email, password] of [[asha, 'asha@demo.edu', 'Student123!'], [ravi, 'ravi@demo.edu', 'Student123!'], [faculty, 'faculty@demo.edu', 'Faculty123!']]) {
    await agent.post('/api/auth/login').send({ email, password }).expect(200);
  }
});
after(() => context.close());
it('keeps saved collections private, searches beyond the first page, and restricts edits to authors', async () => {
  const { body: { id } } = await asha.post('/api/posts').send({ caption: 'Scholarship workshop 100% useful' }).expect(201);
  await ravi.put(`/api/posts/${id}/save`).expect(200);
  await ravi.put(`/api/posts/${id}/save`).expect(200);
  assert.equal((await ravi.get('/api/posts?view=saved')).body.posts.length, 1);
  assert.equal((await faculty.get('/api/posts?view=saved')).body.posts.length, 0);
  assert.equal((await ravi.get('/api/posts?view=mine')).body.posts.length, 0);
  assert.equal((await asha.get('/api/posts?view=mine')).body.posts[0].id, id);
  await faculty.patch(`/api/posts/${id}`).send({ caption: 'Changed by someone else' }).expect(403);
  await asha.patch(`/api/posts/${id}`).send({ caption: ' ' }).expect(400);
  await asha.patch(`/api/posts/${id}`).send({ caption: 'Updated scholarship workshop 100%' }).expect(200);
  const saved = (await ravi.get('/api/posts?view=saved&q=scholarship')).body.posts[0];
  assert.equal(saved.caption, 'Updated scholarship workshop 100%');
  assert.equal(saved.saved, 1);
  assert.equal((await ravi.get('/api/posts?q=Asha')).body.posts[0].id, id);
  assert.equal((await ravi.get('/api/posts?q=100%25')).body.posts[0].id, id);
  await ravi.get('/api/posts?view=invalid').expect(400);
  await ravi.delete(`/api/posts/${id}/save`).expect(200);
  assert.equal((await ravi.get('/api/posts?view=saved')).body.posts.length, 0);
  await asha.delete(`/api/posts/${id}`).expect(200);
});
it('shares student photos across memberships and roles, persists reactions, and enforces ownership', async () => {
  await request(context.app).get('/api/posts').expect(401);
  await request(context.app).post('/api/posts').send({ caption: 'Unauthorized' }).expect(401);
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  const { body: { id } } = await asha.post('/api/posts').send({ caption: 'Our robotics team won!', image }).expect(201);
  for (const agent of [ravi, faculty]) {
    const { body } = await agent.get('/api/posts').expect(200);
    assert.equal(body.posts[0].id, id);
    assert.equal(body.posts[0].authorName, 'Asha Rao');
    assert.equal(body.posts[0].hasImage, 1);
    await agent.get(`/api/posts/${id}/image`).expect('Content-Type', /image\/png/).expect(200);
    await agent.delete(`/api/posts/${id}`).expect(403);
  }
  await request(context.app).get(`/api/posts/${id}/image`).expect(401);
  await ravi.put(`/api/posts/${id}/like`).expect(200);
  await ravi.put(`/api/posts/${id}/like`).expect(200);
  let post = (await ravi.get('/api/posts')).body.posts[0];
  assert.equal(post.likeCount, 1);
  assert.equal(post.liked, 1);
  await faculty.post(`/api/posts/${id}/comments`).send({ text: 'Congratulations to the team!' }).expect(201);
  const comments = (await asha.get(`/api/posts/${id}/comments`).expect(200)).body.comments;
  assert.equal(comments[0].text, 'Congratulations to the team!');
  await ravi.delete(`/api/posts/${id}/like`).expect(200);
  assert.equal((await ravi.get('/api/posts')).body.posts[0].likeCount, 0);
  await asha.delete(`/api/posts/${id}`).expect(200);
  await ravi.get(`/api/posts/${id}/image`).expect(404);
  await ravi.post(`/api/posts/${id}/comments`).send({ text: 'Late reply' }).expect(404);
  assert.equal(context.db.prepare('SELECT COUNT(*) AS n FROM campus_comments').get().n, 0);
});
it('rejects invalid captions and image content and paginates campus posts', async () => {
  for (const body of [{ caption: ' ' }, { caption: 'x'.repeat(2001) }, { caption: 'Test', image: 'data:image/png;base64,aGVsbG8=' }, { caption: 'Test', image: 'https://example.com/image.png' }]) {
    await asha.post('/api/posts').send(body).expect(400);
  }
  for (let i = 0; i < 21; i++) await faculty.post('/api/posts').send({ caption: `Campus update ${i}` }).expect(201);
  const first = (await asha.get('/api/posts').expect(200)).body;
  assert.equal(first.posts.length, 20);
  const second = (await asha.get(`/api/posts?before=${first.nextCursor}`).expect(200)).body;
  assert.equal(second.posts.length, 1);
  assert.equal(second.nextCursor, null);
  assert(second.posts[0].id < first.posts[19].id);
  const oldestMatch = (await asha.get('/api/posts?q=Campus%20update%200').expect(200)).body;
  assert.equal(oldestMatch.posts.length, 1);
  assert.equal(oldestMatch.posts[0].id, second.posts[0].id);
});
it('validates topics, preserves them on caption edits, and lets only authors change them', async () => {
  for (const topic of ['unknown', '', 'all', null, {}, ['event']]) {
    await asha.post('/api/posts').send({ caption: 'Campus news', topic }).expect(400);
  }
  await asha.get('/api/posts?topic=invalid').expect(400);
  await asha.get('/api/posts?topic=event&topic=question').expect(400);
  const { body: { id } } = await asha.post('/api/posts').send({ caption: 'Student team wins', topic: 'achievement' }).expect(201);
  await faculty.patch(`/api/posts/${id}`).send({ caption: 'Changed', topic: 'general' }).expect(403);
  await asha.patch(`/api/posts/${id}`).send({ caption: 'Changed', topic: 'invalid' }).expect(400);
  await asha.patch(`/api/posts/${id}`).send({ caption: 'Updated team win' }).expect(200);
  assert.equal((await ravi.get('/api/posts?topic=achievement')).body.posts[0].topic, 'achievement');
  await asha.patch(`/api/posts/${id}`).send({ caption: 'Meet our winning team', topic: 'event' }).expect(200);
  assert.equal((await ravi.get('/api/posts?topic=achievement')).body.posts.length, 0);
  assert.equal((await ravi.get('/api/posts?topic=event')).body.posts[0].id, id);
  const { body: { id: defaultId } } = await asha.post('/api/posts').send({ caption: 'A day on campus' }).expect(201);
  assert.equal((await faculty.get('/api/posts?topic=general')).body.posts[0].id, defaultId);
  assert.equal(context.db.prepare('SELECT topic FROM campus_posts WHERE id = ?').get(defaultId).topic, 'general');
  for (const postId of [id, defaultId]) await asha.delete(`/api/posts/${postId}`).expect(200);
});
it('combines topics with search, ownership, private saves, and cursor pagination', async () => {
  const ids = [];
  for (let i = 0; i < 21; i++) {
    const { body: { id } } = await asha.post('/api/posts').send({ caption: `Scholarship event ${i}`, topic: 'event' }).expect(201);
    ids.push(id);
    await ravi.put(`/api/posts/${id}/save`).expect(200);
  }
  await asha.post('/api/posts').send({ caption: 'Scholarship announcement', topic: 'opportunity' }).expect(201);
  await asha.post('/api/posts').send({ caption: 'Robotics meetup', topic: 'event' }).expect(201);
  await faculty.post('/api/posts').send({ caption: 'Scholarship faculty talk', topic: 'event' }).expect(201);
  for (const [agent, view] of [[asha, 'mine'], [ravi, 'saved']]) {
    const query = `/api/posts?topic=event&view=${view}&q=Scholarship`;
    const first = (await agent.get(query).expect(200)).body;
    assert.equal(first.posts.length, 20);
    assert(first.posts.every((post) => post.topic === 'event' && ids.includes(post.id)));
    const second = (await agent.get(`${query}&before=${first.nextCursor}`).expect(200)).body;
    assert.equal(second.posts.length, 1);
    assert.equal(second.nextCursor, null);
    assert.equal(second.posts[0].id, ids[0]);
    assert.equal(new Set([...first.posts, ...second.posts].map((post) => post.id)).size, 21);
  }
  assert.equal((await faculty.get('/api/posts?topic=event&view=saved&q=Scholarship')).body.posts.length, 0);
  assert.equal((await ravi.get('/api/posts?topic=opportunity&view=saved')).body.posts.length, 0);
});
it('migrates existing posts to campus life and retains topics across database restarts', () => {
  const filename = path.join(WORKSPACE_ROOT, 'test', `.campus-topics-${randomUUID()}.db`);
  let db;
  try {
    db = openDatabase({ filename, bcryptRounds: 4 });
    db.exec('DROP INDEX idx_campus_posts_topic; ALTER TABLE campus_posts DROP COLUMN topic;');
    const userId = db.prepare("SELECT id FROM users WHERE email = 'asha@demo.edu'").get().id;
    db.prepare('INSERT INTO campus_posts(user_id, caption, created_at) VALUES (?, ?, ?)').run(userId, 'Existing campus memory', new Date().toISOString());
    db.close();
    db = openDatabase({ filename, seed: false });
    assert.equal(db.prepare('SELECT topic FROM campus_posts').get().topic, 'general');
    db.prepare("UPDATE campus_posts SET topic = 'question'").run();
    db.close();
    db = openDatabase({ filename, seed: false });
    assert.deepEqual({ ...db.prepare('SELECT caption, topic FROM campus_posts').get() }, { caption: 'Existing campus memory', topic: 'question' });
  } finally {
    if (db?.open) db.close();
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${filename}${suffix}`, { force: true });
  }
});
