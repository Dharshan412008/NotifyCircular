'use strict';
const assert = require('node:assert/strict');
const { it } = require('node:test');
const express = require('express');
const request = require('supertest');
const { applySecurity } = require('../src/security');

function fixture(options = {}, env = {}) {
  const app = express();
  applySecurity(app, { options, env });
  app.post('/api/auth/login', (_req, res) => res.status(401).json({ failed: true }));
  app.post('/api/posts', (_req, res) => res.json({ ok: true }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  return app;
}

it('rejects cross-site mutations and permits the local Vite proxy origin', async () => {
  const app = fixture();
  await request(app).post('/api/posts').set('Origin', 'https://attacker.example').expect(403);
  await request(app).post('/api/posts').set('Origin', 'null').expect(403);
  await request(app).post('/api/posts').set('Sec-Fetch-Site', 'cross-site').expect(403);
  await request(app).post('/api/posts').set('Origin', 'http://127.0.0.1:5173').expect(200);
  await request(app).post('/api/posts').expect(200);
  const response = await request(app).get('/api/health').expect(200);
  assert.match(response.headers['content-security-policy'], /object-src 'none'/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(response.headers['x-request-id'], /^[a-f\d-]{36}$/);
});

it('production rejects development origins and accepts the explicitly configured application', async () => {
  const app = fixture({}, { NODE_ENV: 'production', APP_URL: 'https://campus.example' });
  await request(app).post('/api/posts').set('Origin', 'http://127.0.0.1:5173').expect(403);
  const response = await request(app).post('/api/posts').set('Origin', 'https://campus.example').expect(200);
  assert(response.headers['strict-transport-security']);
});

it('limits failed sign-ins and logs only safe request metadata', async () => {
  const logs = [];
  const app = fixture({ authRateLimit: 2, requestLogger: (entry) => logs.push(entry) });
  await request(app).post('/api/auth/login?token=secret').send({ password: 'private' }).expect(401);
  await request(app).post('/api/auth/login').expect(401);
  const response = await request(app).post('/api/auth/login').expect(429);
  assert.equal(response.body.error.code, 'too_many_attempts');
  assert(!JSON.stringify(logs).includes('secret'));
  assert(!JSON.stringify(logs).includes('password'));
  assert.equal(logs[0].route, '/api/auth/login');
});
