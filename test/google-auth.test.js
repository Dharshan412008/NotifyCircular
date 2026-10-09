'use strict';
const assert = require('node:assert/strict');
const { it } = require('node:test');
const request = require('supertest');
const crypto = require('node:crypto');
const { createApplication } = require('../src/app');

async function fixture(run) {
  const profile = { sub: 'google-student-1', email: 'newstudent@srishakthi.ac.in', email_verified: true, hd: 'srishakthi.ac.in', name: 'College Student' };
  let exchange;
  const app = createApplication({ dbPath: ':memory:', envName: 'test', bcryptRounds: 4, disableOutboundNotifications: true,
    env: { AUTH_MODE: 'google', GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', APP_URL: 'http://127.0.0.1:5173', COLLEGE_EMAIL_DOMAINS: 'srishakthi.ac.in' },
    googleFetch: async (url, options) => {
      if (url === 'https://oauth2.googleapis.com/token') { exchange = new URLSearchParams(options.body); return new Response(JSON.stringify({ access_token: 'verified-access-token' })); }
      assert.equal(url, 'https://openidconnect.googleapis.com/v1/userinfo');
      assert.equal(options.headers.Authorization, 'Bearer verified-access-token');
      return new Response(JSON.stringify(profile));
    },
  });
  const agent = request.agent(app.app);
  async function start(role = 'student') { return new URL((await agent.get('/api/auth/google/start?role=' + role).expect(302)).headers.location); }
  async function finish(url) { return agent.get('/api/auth/google/callback').query({ state: url.searchParams.get('state'), code: 'one-use-code' }).expect(302); }
  try { await run({ app, agent, profile, start, finish, exchange: () => exchange }); } finally { app.close(); }
}

it('uses state and PKCE, verifies college identity, creates only a student and restores a session', () => fixture(async ({ app, agent, start, finish, exchange }) => {
  await agent.post('/api/auth/login').send({ email: 'asha@demo.edu', password: 'Student123!' }).expect(403);
  await agent.post('/api/auth/register').send({}).expect(403);
  const url = await start();
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('hd'), 'srishakthi.ac.in');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:5173/api/auth/google/callback');
  assert.equal((await finish(url)).headers.location, 'http://127.0.0.1:5173/student');
  const user = (await agent.get('/api/auth/me').expect(200)).body.user;
  assert.equal(user.email, 'newstudent@srishakthi.ac.in'); assert.equal(user.role, 'student'); assert.equal(user.year, null);
  const groups = app.db.prepare('SELECT g.kind FROM groups g JOIN student_group_memberships m ON g.id=m.group_id WHERE student_id=?').all(user.id);
  assert(groups.length > 0 && groups.every((g) => g.kind === 'broadcast'));
  assert.equal(crypto.createHash('sha256').update(exchange().get('code_verifier')).digest('base64url'), url.searchParams.get('code_challenge'));
  assert.match((await finish(url)).headers.location, /authError=expired$/);
}));

it('rejects consumer accounts, unverified addresses, wrong Workspace domains and state tampering', () => fixture(async ({ agent, profile, start, finish }) => {
  for (const invalid of [{ email_verified: false }, { hd: '' }, { hd: 'other.edu' }, { email: 'someone@gmail.com' }, { email: 'someone@srishakthi.ac.in.attacker.com' }]) {
    const original = { ...profile }; Object.assign(profile, invalid);
    assert.match((await finish(await start())).headers.location, /authError=college_email$/);
    Object.assign(profile, original);
  }
  await start();
  const failure = await agent.get('/api/auth/google/callback?code=fake&state=wrong').expect(302);
  assert.match(failure.headers.location, /authError=expired$/);
  assert.equal((await agent.get('/api/auth/me')).body.user, null);
}));

it('requires approved faculty roles and refuses role switching or disabled accounts', () => fixture(async ({ app, agent, profile, start, finish }) => {
  assert.match((await finish(await start('faculty'))).headers.location, /faculty\?authError=approval$/);
  assert(!app.db.prepare('SELECT id FROM users WHERE email=?').get(profile.email));
  app.db.prepare("UPDATE users SET email=? WHERE email='faculty@demo.edu'").run(profile.email);
  assert.match((await finish(await start('student'))).headers.location, /student\?authError=role$/);
  assert.match((await finish(await start('faculty'))).headers.location, /faculty\/compose$/);
  assert.equal((await agent.get('/api/auth/me')).body.user.role, 'faculty');
  await agent.post('/api/auth/logout').send({}).expect(200);
  app.db.prepare('UPDATE users SET disabled=1 WHERE email=?').run(profile.email);
  assert.match((await finish(await start('faculty'))).headers.location, /authError=account$/);
}));

it('does not relink an existing identity to a different Google subject', () => fixture(async ({ agent, profile, start, finish }) => {
  await finish(await start());
  await agent.post('/api/auth/logout').send({}).expect(200);
  profile.sub = 'different-google-account';
  assert.match((await finish(await start())).headers.location, /authError=account$/);
  assert.equal((await agent.get('/api/auth/me')).body.user, null);
}));
