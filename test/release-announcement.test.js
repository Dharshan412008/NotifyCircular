'use strict';
const assert = require('node:assert/strict');
const { it } = require('node:test');
const { openDatabase } = require('../src/db');
const { createReleaseAnnouncement, RELEASE_ID } = require('../src/release-announcement');
const { NotificationService } = require('../src/notifications');

it('announces once to all active accounts and pushes only to opted-in subscriptions', async () => {
  const db = openDatabase({ filename: ':memory:', bcryptRounds: 4 });
  let calls = [];
  const sender = { allowPush: true, sendAppUpdate: async (row, payload) => { calls.push({ row, payload }); return 'sent'; } };
  try {
    const users = db.prepare('SELECT id FROM users ORDER BY id').all();
    const subscribe = db.prepare('INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,created_at,updated_at) VALUES(?,?,?,?,?,?)');
    users.forEach((user, i) => subscribe.run(user.id, `https://push.example/${i}`, 'test-key', 'test-auth', 'now', 'now'));
    db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(users[0].id);
    db.prepare('INSERT INTO notification_preferences(user_id,circular) VALUES(?,0)').run(users[1].id);
    const release = createReleaseAnnouncement(db, sender);
    assert.equal(release.announce(), true);
    assert.equal(db.prepare("SELECT count(*) n FROM platform_notifications WHERE kind='app-update'").get().n, users.length - 1);
    assert.equal(release.announce(), false);
    await release.process();
    assert.equal(calls.length, users.length - 2);
    assert(calls.every(({ payload }) => payload.type === 'app:update' && payload.url === '/'));
    await release.process();
    assert.equal(calls.length, users.length - 2);
    const restarted = createReleaseAnnouncement(db, sender);
    assert.equal(restarted.announce(), false);
    await restarted.process();
    assert.equal(calls.length, users.length - 2);
    release.close(); restarted.close();
  } finally { db.close(); }
});

it('cancels queued notifications for reassigned subscriptions and disabled users, and bounds retries', async () => {
  const db = openDatabase({ filename: ':memory:', bcryptRounds: 4 });
  let sends = 0;
  const sender = { allowPush: true, sendAppUpdate: async () => { sends++; return 'pending'; } };
  try {
    const users = db.prepare('SELECT id FROM users ORDER BY id LIMIT 3').all();
    const insert = db.prepare('INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,created_at,updated_at) VALUES(?,?,?,?,?,?)');
    users.forEach((user, i) => insert.run(user.id, `https://push.example/${i}`, 'key', 'auth', 'now', 'now'));
    const release = createReleaseAnnouncement(db, sender); release.announce();
    db.prepare('UPDATE push_subscriptions SET user_id=? WHERE endpoint=?').run(users[1].id, 'https://push.example/0');
    db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(users[1].id);
    for (let i = 0; i < 5; i++) await release.process();
    assert.equal(sends, 3);
    assert.equal(db.prepare("SELECT count(*) n FROM app_release_push_jobs WHERE status='cancelled'").get().n, 2);
    assert.equal(db.prepare('SELECT attempts FROM app_release_push_jobs WHERE release_id=? AND user_id=?').get(RELEASE_ID, users[2].id).attempts, 3);
    release.close();
  } finally { db.close(); }
});

it('uses the existing web push transport and cleans up expired subscriptions', async () => {
  const db = openDatabase({ filename: ':memory:', bcryptRounds: 4 });
  const user = db.prepare('SELECT id FROM users LIMIT 1').get();
  const mock = {
    generateVAPIDKeys: () => ({ publicKey: 'public', privateKey: 'private' }), setVapidDetails() {},
    sendNotification: async () => { throw Object.assign(new Error('Gone'), { statusCode: 410 }); },
  };
  const service = new NotificationService(db, { webpush: mock, env: { NODE_ENV: 'test' } });
  try {
    service.subscribe(user.id, { endpoint: 'https://push.example/expired', keys: { p256dh: 'key', auth: 'auth' } });
    const row = service.subscriptionsFor(user.id)[0];
    assert.equal(await service.sendAppUpdate(row, { title: 'Update' }), 'expired');
    assert.equal(service.subscriptionsFor(user.id).length, 0);
  } finally { service.close(); db.close(); }
});
