'use strict';
const assert = require('node:assert/strict');
const { it } = require('node:test');
const request = require('supertest');
const { createApplication } = require('../src/app');

it('creates faculty accounts without student memberships and supports faculty login', async () => {
  const context = createApplication({ dbPath: ':memory:', envName: 'test', env: { AUTH_MODE: 'password' }, bcryptRounds: 4, disableOutboundNotifications: true });
  try {
    const agent = request.agent(context.app);
    const result = await agent.post('/api/auth/register').send({ name: 'New Faculty', email: 'teacher@gmail.com', password: 'CampusPass123!', role: 'faculty' }).expect(201);
    assert.equal(result.body.user.role, 'faculty');
    assert.equal(result.body.user.year, null);
    assert.equal(context.db.prepare('SELECT count(*) n FROM student_group_memberships WHERE student_id=?').get(result.body.user.id).n, 0);
    await agent.get('/api/admin/stats').expect(403);
    await agent.post('/api/auth/logout').expect(200);
    await agent.post('/api/auth/login').send({ email: 'teacher@gmail.com', password: 'CampusPass123!', role: 'student' }).expect(403);
    await agent.post('/api/auth/login').send({ email: 'teacher@gmail.com', password: 'CampusPass123!', role: 'faculty' }).expect(200);
  } finally { context.close(); }
});

it('allows normal Gmail registration and password login without email setup or OTP by default', async () => {
  for (const env of [{}, { AUTH_MODE: 'password' }]) {
    const context = createApplication({ dbPath: ':memory:', envName: 'test', env, bcryptRounds: 4, disableOutboundNotifications: true });
    try {
      const agent = request.agent(context.app);
      const settings = (await agent.get('/api/auth/options').expect(200)).body;
      assert.equal(settings.collegePasswordAuth, false);
      assert.deepEqual(settings.domains, []);
      const created = await agent.post('/api/auth/register').send({ name: 'New Student', email: ' Student@GMAIL.COM ', password: 'CampusPass123!', year: 1, role: 'admin' }).expect(201);
      assert.equal(created.body.user.email, 'student@gmail.com');
      assert.equal(created.body.user.role, 'student');
      assert.equal(created.body.verificationRequired, undefined);
      assert.equal((await agent.get('/api/auth/me')).body.user.email, 'student@gmail.com');
      await agent.post('/api/auth/logout').expect(200);
      await agent.post('/api/auth/login').send({ email: 'student@gmail.com', password: 'wrong' }).expect(401);
      await agent.post('/api/auth/login').send({ email: 'student@gmail.com', password: 'CampusPass123!', role: 'faculty' }).expect(403);
      await agent.post('/api/auth/login').send({ email: 'student@gmail.com', password: 'CampusPass123!', role: 'student' }).expect(200);
    } finally { context.close(); }
  }
});

it('restricts password registration and login to the exact college domain and preserves roles', async () => {
  let code;
  const context = createApplication({ dbPath: ':memory:', envName: 'test', env: { AUTH_MODE: 'college', MAIL_FROM: 'CampusRelay <sender@example.com>' }, verificationTransport: { sendMail: async (message) => { code = message.text.match(/code is (\d{6})/)[1]; } }, bcryptRounds: 4, disableOutboundNotifications: true });
  try {
    const agent = request.agent(context.app);
    assert.equal((await agent.get('/api/auth/options').expect(200)).body.localAuth, true);
    for (const email of ['other@gmail.com', 'name@srishakthi.ac.in.attacker.com', 'name@evil-srishakthi.ac.in']) {
      await agent.post('/api/auth/register').send({ name: 'Student Name', email, password: 'Secure123!', year: 1 }).expect(400);
      await agent.post('/api/auth/login').send({ email, password: 'Secure123!' }).expect(400);
    }
    const account = await agent.post('/api/auth/register').send({ name: 'Student Name', email: ' Student@SRISHAKTHI.AC.IN ', password: 'Secure123!', year: 1, role: 'admin' }).expect(201);
    assert.equal(account.body.email, 'student@srishakthi.ac.in');
    assert.equal(account.body.verificationRequired, true);
    assert.equal((await agent.get('/api/auth/me')).body.user, null);
    await agent.post('/api/auth/verification/resend').send({}).expect(429);
    await agent.post('/api/auth/verification/confirm').send({ code: 'invalid' }).expect(400);
    await request(context.app).post('/api/auth/verification/confirm').send({ code }).expect(401);
    const confirmed = await agent.post('/api/auth/verification/confirm').send({ code }).expect(200);
    assert.equal(confirmed.body.user.role, 'student');
    assert.equal((await agent.get('/api/auth/me')).body.user.email, 'student@srishakthi.ac.in');
    await agent.post('/api/auth/verification/confirm').send({ code }).expect(401);
    await agent.post('/api/auth/logout').expect(200);
    await agent.post('/api/auth/login').send({ email: 'student@srishakthi.ac.in', password: 'wrong' }).expect(401);
    await agent.post('/api/auth/login').send({ email: 'student@srishakthi.ac.in', password: 'Secure123!', role: 'faculty' }).expect(403);
    await agent.post('/api/auth/login').send({ email: 'student@srishakthi.ac.in', password: 'Secure123!', role: 'student' }).expect(200);
  } finally { context.close(); }
});
