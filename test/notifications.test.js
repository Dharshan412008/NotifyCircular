'use strict';

const assert = require('node:assert/strict');
const { afterEach, describe, it } = require('node:test');

const { openDatabase } = require('../src/db');
const { NotificationService, createMailer } = require('../src/notifications');
const { hydrateCircular } = require('../src/repository');

describe('notification delivery', () => {
  let db;

  afterEach(() => {
    if (db?.open) db.close();
  });

  it('uses the no-network JSON transport when SMTP is absent', async () => {
    const mailer = createMailer({});
    const info = await mailer.sendMail({
      from: 'no-reply@example.edu',
      to: 'student@example.edu',
      subject: 'Preview',
      text: 'Local preview message',
    });
    const message = JSON.parse(String(info.message));
    assert.match(message.to[0].address, /student@example\.edu/);
    assert.equal(message.subject, 'Preview');
  });

  it('keeps configured SMTP in local preview mode until outbound delivery is enabled', async () => {
    const mailer = createMailer({ NODE_ENV: 'development', SMTP_HOST: 'smtp.invalid.example' });
    const info = await mailer.sendMail({ from: 'campus@example.edu', to: 'student@example.edu', subject: 'Safe development preview', text: 'Not sent over SMTP' });
    assert.equal(JSON.parse(String(info.message)).subject, 'Safe development preview');
  });

  it('respects email preferences and batches daily digests without duplicate delivery', async () => {
    db = openDatabase({ filename: ':memory:', bcryptRounds: 4 });
    const service = new NotificationService(db, { env: { NODE_ENV: 'test' } });
    const asha = db.prepare("SELECT id FROM users WHERE email='asha@demo.edu'").get();
    const ravi = db.prepare("SELECT id FROM users WHERE email='ravi@demo.edu'").get();
    db.prepare("INSERT INTO notification_preferences VALUES(?,1,1,1,1,'daily')").run(asha.id);
    db.prepare("INSERT INTO notification_preferences VALUES(?,1,1,1,0,'instant')").run(ravi.id);
    const row = db.prepare("SELECT c.id FROM circulars c JOIN circular_targets t ON t.circular_id=c.id JOIN groups g ON g.id=t.group_id WHERE g.slug='whole-college' LIMIT 1").get();
    const circular = hydrateCircular(db, row.id);
    assert.deepEqual(await service.notifyCircular(circular), { audienceCount: 2, pushCount: 0, emailFallbackCount: 0 });
    await service.notifyCircular(circular);
    assert.equal(db.prepare('SELECT count(*) count FROM digest_queue').get().count, 1);
    assert.equal(service.previewMessages.length, 0);
    assert.deepEqual(await service.processDigests(), { sent: 0 });
    assert.deepEqual(await service.processDigests({ force: true }), { sent: 1 });
    assert.equal(service.previewMessages.length, 1);
    const digest = JSON.parse(service.previewMessages[0]);
    assert.equal(digest.to[0].address, 'asha@demo.edu');
    assert.match(digest.subject, /daily digest/);
    assert.deepEqual(await service.processDigests({ force: true }), { sent: 0 });
    assert.equal(db.prepare("SELECT count(*) count FROM delivery_log WHERE channel='digest' AND status='preview'").get().count, 1);
    service.close();
  });

  it('rechecks digest membership and account status before delivery', async () => {
    db = openDatabase({ filename: ':memory:', bcryptRounds: 4 });
    const service = new NotificationService(db, { env: { NODE_ENV: 'test' } });
    const asha = db.prepare("SELECT id FROM users WHERE email='asha@demo.edu'").get();
    const row = db.prepare("SELECT c.id,t.group_id FROM circulars c JOIN circular_targets t ON t.circular_id=c.id JOIN groups g ON g.id=t.group_id WHERE g.slug='sports' LIMIT 1").get();
    db.prepare("INSERT INTO notification_preferences VALUES(?,1,1,1,1,'daily')").run(asha.id);
    await service.notifyCircular(hydrateCircular(db, row.id));
    db.prepare('DELETE FROM student_group_memberships WHERE student_id=? AND group_id=?').run(asha.id, row.group_id);
    assert.deepEqual(await service.processDigests({ force: true }), { sent: 0 });
    assert.equal(service.previewMessages.length, 0);
    assert.equal(db.prepare('SELECT count(*) count FROM digest_queue').get().count, 0);
    service.close();
  });

  it('prefers successful Web Push and emails recipients without push', async () => {
    db = openDatabase({ filename: ':memory:', bcryptRounds: 4 });
    const sentEmails = [];
    const sentPushes = [];
    const mockMailer = {
      async sendMail(message) {
        sentEmails.push(message);
        return { messageId: `preview-${sentEmails.length}` };
      },
    };
    const mockWebpush = {
      generateVAPIDKeys() {
        return { publicKey: 'test-public-key', privateKey: 'test-private-key' };
      },
      setVapidDetails() {},
      async sendNotification(subscription, payload) {
        sentPushes.push({ subscription, payload: JSON.parse(payload) });
        return { statusCode: 201 };
      },
    };
    const service = new NotificationService(db, {
      env: { NODE_ENV: 'test' },
      mailer: mockMailer,
      webpush: mockWebpush,
    });
    const asha = db.prepare("SELECT id FROM users WHERE email = 'asha@demo.edu'").get();
    service.subscribe(asha.id, {
      endpoint: 'https://push.example.test/asha',
      expirationTime: null,
      keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
    });
    const welcome = db
      .prepare(`
        SELECT c.id
        FROM circulars c
        JOIN circular_targets ct ON ct.circular_id = c.id
        JOIN groups g ON g.id = ct.group_id
        WHERE g.slug = 'whole-college'
      `)
      .get();
    const circular = hydrateCircular(db, welcome.id);
    const delivery = await service.notifyCircular(circular);

    assert.deepEqual(delivery, { audienceCount: 2, pushCount: 1, emailFallbackCount: 1 });
    assert.equal(sentPushes.length, 1);
    assert.equal(sentPushes[0].payload.circularId, circular.id);
    assert.equal(sentPushes[0].payload.url, `/student/circulars/${circular.id}`);
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, 'ravi@demo.edu');
  });

  it('transfers a browser endpoint to the latest user and removes expired subscriptions', () => {
    db = openDatabase({ filename: ':memory:', bcryptRounds: 4 });
    const service = new NotificationService(db, {
      env: { NODE_ENV: 'test' },
      mailer: { async sendMail() { return {}; } },
      webpush: {
        generateVAPIDKeys() {
          return { publicKey: 'test-public-key', privateKey: 'test-private-key' };
        },
        setVapidDetails() {},
      },
    });
    const asha = db.prepare("SELECT id FROM users WHERE email = 'asha@demo.edu'").get();
    const ravi = db.prepare("SELECT id FROM users WHERE email = 'ravi@demo.edu'").get();
    const sharedEndpoint = 'https://push.example.test/shared-browser';

    service.subscribe(asha.id, {
      endpoint: sharedEndpoint,
      expirationTime: null,
      keys: { p256dh: 'asha-key', auth: 'asha-auth' },
    });
    service.subscribe(ravi.id, {
      endpoint: sharedEndpoint,
      expirationTime: null,
      keys: { p256dh: 'ravi-key', auth: 'ravi-auth' },
    });
    service.subscribe(asha.id, {
      endpoint: 'https://push.example.test/expired',
      expirationTime: Date.now() - 1,
      keys: { p256dh: 'expired-key', auth: 'expired-auth' },
    });

    assert.equal(service.subscriptionsFor(asha.id).length, 0);
    const raviSubscriptions = service.subscriptionsFor(ravi.id);
    assert.equal(raviSubscriptions.length, 1);
    assert.equal(raviSubscriptions[0].endpoint, sharedEndpoint);
    assert.equal(raviSubscriptions[0].p256dh, 'ravi-key');
  });

  it('removes line breaks from email subjects', async () => {
    db = openDatabase({ filename: ':memory:', bcryptRounds: 4 });
    const messages = [];
    const service = new NotificationService(db, {
      env: { NODE_ENV: 'test', SMTP_HOST: 'smtp.example.test' },
      mailer: {
        async sendMail(message) {
          messages.push(message);
          return { messageId: 'safe-subject' };
        },
      },
      webpush: {
        generateVAPIDKeys() {
          return { publicKey: 'test-public-key', privateKey: 'test-private-key' };
        },
        setVapidDetails() {},
      },
    });

    await service.sendEmail(
      { email: 'student@example.edu' },
      {
        id: 1,
        urgency: 'urgent',
        summary: 'Council update\r\nInjected header',
        text: 'Please attend.',
        requiresAcknowledgment: false,
      },
    );
    assert.equal(messages[0].subject, '[URGENT] Council update Injected header');
  });
});
