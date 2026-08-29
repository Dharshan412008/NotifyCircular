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
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, 'ravi@demo.edu');
  });
});
