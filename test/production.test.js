'use strict';
const assert = require('node:assert/strict');
const { it } = require('node:test');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApplication } = require('../src/app');

it('requires a production secret, seeds only audiences, and serves secure authenticated SPA routes', async () => {
  assert.throws(() => createApplication({ dbPath: ':memory:', env: { NODE_ENV: 'production' } }), /SESSION_SECRET/);
  const distPath = fs.mkdtempSync(path.join(os.tmpdir(), 'campusrelay-production-'));
  const indexPath = path.join(distPath, 'index.html');
  fs.writeFileSync(indexPath, '<!doctype html><title>CampusRelay production fixture</title>');
  const context = createApplication({ dbPath: ':memory:', distPath, env: { NODE_ENV: 'production', SESSION_SECRET: 'isolated-production-test-secret-32-characters', TRUST_PROXY: '1', APP_URL: 'https://campus.example.edu' }, disableOutboundNotifications: true });
  try {
    assert.equal(context.db.prepare('SELECT count(*) n FROM users').get().n, 0);
    assert.equal(context.db.prepare("SELECT count(*) n FROM groups WHERE kind='year'").get().n, 4);
    context.db.prepare("INSERT INTO users(name,email,password_hash,role,year,created_at) VALUES('Admin','admin@example.edu',?,'admin',NULL,?)").run(bcrypt.hashSync('TestAdmin123!', 4), new Date().toISOString());
    await request(context.app).get('/api/health').expect(200);
    const login = await request(context.app).post('/api/auth/login').set('X-Forwarded-Proto', 'https').set('Origin', 'https://campus.example.edu').send({ email: 'admin@example.edu', password: 'TestAdmin123!' }).expect(200);
    const cookie = login.headers['set-cookie'][0];
    assert.match(cookie, /Secure/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/);
    await request(context.app).get('/api/admin/stats').set('Cookie', cookie.split(';')[0]).set('X-Forwarded-Proto', 'https').expect(200);
    await request(context.app).post('/api/auth/logout').set('Origin', 'https://untrusted.example').expect(403);
    await request(context.app).get('/faculty/analytics').expect(200).expect('Content-Type', /html/);
  } finally { context.close(); fs.unlinkSync(indexPath); fs.rmdirSync(distPath); }
});
