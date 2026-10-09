'use strict';
const assert = require('node:assert/strict');
const { it } = require('node:test');
const request = require('supertest');
const { createApplication } = require('../src/app');

async function fixture(run, overrides = {}) {
  const messages = [];
  const context = createApplication({ dbPath: ':memory:', envName: 'test', bcryptRounds: 4, disableOutboundNotifications: true,
    env: { AUTH_MODE: 'college', MAIL_FROM: 'sender@example.com' },
    verificationTransport: { sendMail: async (message) => messages.push(message) }, ...overrides });
  const agent = request.agent(context.app);
  const payload = { name: 'College Student', email: 'student@srishakthi.ac.in', password: 'Secure123!', year: 1 };
  const code = () => messages.at(-1).text.match(/code is (\d{6})/)[1];
  try { await run({ context, agent, payload, messages, code }); } finally { context.close(); }
}

it('expires codes, limits guesses, invalidates old codes on resend, and binds verification to the email', () => fixture(async ({ context, agent, payload, messages, code }) => {
  const response = await agent.post('/api/auth/register').send(payload).expect(201);
  assert(!JSON.stringify(response.body).includes(code()));
  assert.equal(messages[0].to, payload.email);
  const row = context.db.prepare('SELECT * FROM email_verifications').get();
  assert.notEqual(row.code_hash, code());
  await agent.get('/api/admin/stats').expect(401);
  context.db.prepare('UPDATE email_verifications SET expires_at=0').run();
  await agent.post('/api/auth/verification/confirm').send({ code: code() }).expect(400);
  context.db.prepare('UPDATE email_verifications SET sent_at=0').run();
  const oldHash = context.db.prepare('SELECT code_hash FROM email_verifications').get().code_hash;
  await agent.post('/api/auth/verification/resend').send({}).expect(200);
  assert.notEqual(context.db.prepare('SELECT code_hash FROM email_verifications').get().code_hash, oldHash);
  const wrongCode = code() === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) await agent.post('/api/auth/verification/confirm').send({ code: wrongCode }).expect(400);
  await agent.post('/api/auth/verification/confirm').send({ code: code() }).expect(429);
  context.db.prepare('UPDATE email_verifications SET sent_at=0').run();
  await agent.post('/api/auth/verification/resend').send({}).expect(200);
  await agent.post('/api/auth/verification/confirm').send({ code: code() }).expect(200);
  const user = context.db.prepare('SELECT id FROM users WHERE email=?').get(payload.email);
  assert(context.app.locals.emailVerification.verified(user.id));
  context.db.prepare('UPDATE users SET email=? WHERE id=?').run('changed@srishakthi.ac.in', user.id);
  assert(!context.app.locals.emailVerification.verified(user.id));
  assert.equal((await agent.get('/api/auth/me')).body.user, null);
}));

it('blocks missing or failed real email delivery without granting a session', async () => {
  await fixture(async ({ context, agent, payload }) => {
    const response = await agent.post('/api/auth/register').send(payload).expect(400);
    assert.equal(response.body.error.code, 'email_delivery_unavailable');
    assert(!context.db.prepare('SELECT id FROM users WHERE email=?').get(payload.email));
  }, { verificationTransport: null });
  await fixture(async ({ context, agent, payload }) => {
    const response = await agent.post('/api/auth/register').send(payload).expect(400);
    assert.equal(response.body.error.code, 'email_delivery_failed');
    assert.equal((await agent.get('/api/auth/me')).body.user, null);
    assert.equal(context.db.prepare('SELECT code_hash FROM email_verifications').get().code_hash, null);
  }, { verificationTransport: { sendMail: async () => { throw new Error('private SMTP failure'); } } });
});
