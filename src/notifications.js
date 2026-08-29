'use strict';

const nodemailer = require('nodemailer');
const webpush = require('web-push');
const { audienceRows } = require('./repository');
const { getSetting, setSetting, utcNow } = require('./db');

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function createMailer(env = process.env) {
  if (env.SMTP_HOST) {
    const config = {
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT || 587),
      secure: String(env.SMTP_SECURE || '').toLowerCase() === 'true',
      connectionTimeout: Number(env.SMTP_CONNECTION_TIMEOUT_MS || 10_000),
      greetingTimeout: Number(env.SMTP_GREETING_TIMEOUT_MS || 10_000),
      socketTimeout: Number(env.SMTP_SOCKET_TIMEOUT_MS || 15_000),
    };
    if (env.SMTP_USER) {
      config.auth = { user: env.SMTP_USER, pass: env.SMTP_PASS || '' };
    }
    return nodemailer.createTransport(config);
  }
  return nodemailer.createTransport({ jsonTransport: true });
}

class NotificationService {
  constructor(db, options = {}) {
    this.db = db;
    this.env = options.env || process.env;
    this.disabled = Boolean(options.disabled);
    this.mailer = options.mailer || createMailer(this.env);
    this.webpush = options.webpush || webpush;
    this.previewMessages = [];

    let publicKey = this.env.VAPID_PUBLIC_KEY || getSetting(db, 'vapid_public_key');
    let privateKey = this.env.VAPID_PRIVATE_KEY || getSetting(db, 'vapid_private_key');
    if (!publicKey || !privateKey) {
      const generated = this.webpush.generateVAPIDKeys();
      publicKey = generated.publicKey;
      privateKey = generated.privateKey;
      setSetting(db, 'vapid_public_key', publicKey);
      setSetting(db, 'vapid_private_key', privateKey);
    }
    this.publicKey = publicKey;
    this.webpush.setVapidDetails(
      this.env.VAPID_SUBJECT || 'mailto:admin@notifycircular.local',
      publicKey,
      privateKey,
    );
  }

  getPublicKey() {
    return this.publicKey;
  }

  subscribe(userId, subscription) {
    const now = utcNow();
    this.db
      .prepare(`
        INSERT INTO push_subscriptions
          (user_id, endpoint, expiration_time, p256dh, auth, created_at, updated_at)
        VALUES
          (@userId, @endpoint, @expirationTime, @p256dh, @auth, @now, @now)
        ON CONFLICT(user_id, endpoint) DO UPDATE SET
          expiration_time = excluded.expiration_time,
          p256dh = excluded.p256dh,
          auth = excluded.auth,
          updated_at = excluded.updated_at
      `)
      .run({
        userId,
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime || null,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        now,
      });
  }

  unsubscribe(userId, endpoint) {
    const result = this.db
      .prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
      .run(userId, endpoint);
    return result.changes > 0;
  }

  subscriptionsFor(userId) {
    return this.db
      .prepare(`
        SELECT id, endpoint, expiration_time, p256dh, auth
        FROM push_subscriptions
        WHERE user_id = ?
      `)
      .all(userId);
  }

  async sendPush(row, circular) {
    const payload = JSON.stringify({
      type: 'circular:new',
      title: circular.urgency === 'urgent' ? 'Urgent college circular' : 'New college circular',
      body: circular.summary,
      circularId: circular.id,
      urgency: circular.urgency,
      url: `/?circular=${circular.id}`,
    });
    try {
      await this.webpush.sendNotification(
        {
          endpoint: row.endpoint,
          expirationTime: row.expiration_time || null,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        payload,
        { TTL: 24 * 60 * 60, urgency: circular.urgency === 'urgent' ? 'high' : 'normal' },
      );
      return true;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        this.db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(row.id);
      }
      return false;
    }
  }

  async sendEmail(recipient, circular) {
    const info = await this.mailer.sendMail({
      from: this.env.MAIL_FROM || 'NotifyCircular <no-reply@notifycircular.local>',
      to: recipient.email,
      subject: `${circular.urgency === 'urgent' ? '[URGENT] ' : ''}${circular.summary}`.slice(
        0,
        180,
      ),
      text: `${circular.summary}\n\n${circular.text}\n\nOpen NotifyCircular to read${
        circular.requiresAcknowledgment ? ' and acknowledge' : ''
      } this notice.`,
      html: `<p><strong>${htmlEscape(circular.summary)}</strong></p><p>${htmlEscape(
        circular.text,
      ).replace(/\n/g, '<br>')}</p><p>Open NotifyCircular to read${
        circular.requiresAcknowledgment ? ' and acknowledge' : ''
      } this notice.</p>`,
    });
    if (!this.env.SMTP_HOST && info.message) {
      this.previewMessages.push(String(info.message));
      if (this.previewMessages.length > 20) this.previewMessages.shift();
    }
    return info;
  }

  async notifyCircular(circular) {
    const recipients = audienceRows(this.db, circular.id);
    const delivery = {
      audienceCount: recipients.length,
      pushCount: 0,
      emailFallbackCount: 0,
    };
    if (this.disabled) return delivery;

    for (const recipient of recipients) {
      const subscriptions = this.subscriptionsFor(recipient.id);
      let pushed = false;
      if (subscriptions.length) {
        const outcomes = await Promise.all(
          subscriptions.map((subscription) => this.sendPush(subscription, circular)),
        );
        pushed = outcomes.some(Boolean);
      }
      if (pushed) {
        delivery.pushCount += 1;
      } else {
        try {
          await this.sendEmail(recipient, circular);
          delivery.emailFallbackCount += 1;
        } catch (error) {
          if (this.env.NODE_ENV !== 'test') {
            console.error(`Email delivery failed for circular ${circular.id}:`, error.message);
          }
        }
      }
    }
    return delivery;
  }
}

module.exports = { NotificationService, createMailer };
