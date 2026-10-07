'use strict';

const nodemailer = require('nodemailer');
const webpush = require('web-push');
const { audienceRows, hydrateCircular, userCanReceiveCircular } = require('./repository');
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
  if (env.SMTP_HOST && (env.NODE_ENV === 'production' || env.ALLOW_OUTBOUND_NOTIFICATIONS === 'true')) {
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
    this.emailMode = this.env.SMTP_HOST && (this.env.NODE_ENV === 'production' || this.env.ALLOW_OUTBOUND_NOTIFICATIONS === 'true') ? 'smtp' : 'local-preview';
    this.mailer = options.mailer || createMailer(this.env);
    this.webpush = options.webpush || webpush;
    this.allowPush = Boolean(options.webpush) || this.env.NODE_ENV === 'production' || this.env.ALLOW_OUTBOUND_NOTIFICATIONS === 'true';
    this.previewMessages = [];
    this.closed = false;

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
        ON CONFLICT(endpoint) DO UPDATE SET
          user_id = excluded.user_id,
          expiration_time = excluded.expiration_time,
          p256dh = excluded.p256dh,
          auth = excluded.auth,
          updated_at = excluded.updated_at
      `)
      .run({
        userId,
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime ?? null,
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
    this.db
      .prepare('DELETE FROM push_subscriptions WHERE expiration_time IS NOT NULL AND expiration_time <= ?')
      .run(Date.now());
    return this.db
      .prepare(`
        SELECT id, endpoint, expiration_time, p256dh, auth
        FROM push_subscriptions
        WHERE user_id = ?
      `)
      .all(userId);
  }

  async sendPush(row, circular, recipient) {
    if (!this.allowPush || this.disabled || this.closed) return false;
    const payload = JSON.stringify({
      type: 'circular:new',
      title: circular.urgency === 'urgent' ? 'Urgent college circular' : 'New college circular',
      body: circular.summary,
      circularId: circular.id,
      urgency: circular.urgency,
      url: recipient?.role === 'faculty'
        ? '/faculty/sent'
        : `/student/circulars/${circular.id}`,
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
    const subject = String(circular.summary || 'College circular')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const info = await this.mailer.sendMail({
      from: this.env.MAIL_FROM || 'NotifyCircular <no-reply@notifycircular.local>',
      to: recipient.email,
      subject: `${circular.urgency === 'urgent' ? '[URGENT] ' : ''}${subject}`.slice(
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
    if (this.emailMode === 'local-preview' && info.message) {
      this.previewMessages.push(String(info.message));
      if (this.previewMessages.length > 20) this.previewMessages.shift();
    }
    return info;
  }

  async notifyCircular(circular) {
    const recipients = audienceRows(this.db, circular.id).filter((recipient) => !this.db.prepare('SELECT disabled FROM users WHERE id=?').get(recipient.id)?.disabled);
    const delivery = {
      audienceCount: recipients.length,
      pushCount: 0,
      emailFallbackCount: 0,
    };
    if (this.disabled || this.closed) return delivery;

    for (const recipient of recipients) {
      if (this.closed) break;
      const prefs = this.preferencesFor(recipient.id);
      if (!prefs.circular) continue;
      const subscriptions = this.subscriptionsFor(recipient.id);
      let pushed = false;
      if (subscriptions.length) {
        const outcomes = await Promise.all(
          subscriptions.map((subscription) => this.sendPush(subscription, circular, recipient)),
        );
        pushed = outcomes.some(Boolean);
      }
      if (pushed) {
        delivery.pushCount += 1;
        this.logDelivery(recipient.id, circular.id, 'push', 'sent');
      } else {
        if (!prefs.email) continue;
        if (prefs.digest === 'daily') {
          this.db.prepare('INSERT OR IGNORE INTO digest_queue(user_id,circular_id,created_at) VALUES(?,?,?)').run(recipient.id, circular.id, utcNow());
          this.logDelivery(recipient.id, circular.id, 'digest', 'queued');
          continue;
        }
        try {
          await this.sendEmail(recipient, circular);
          delivery.emailFallbackCount += 1;
          this.logDelivery(recipient.id, circular.id, 'email', this.emailMode === 'smtp' ? 'sent' : 'preview');
        } catch (error) {
          this.logDelivery(recipient.id, circular.id, 'email', 'failed');
        }
      }
    }
    return delivery;
  }

  preferencesFor(userId) {
    const row = this.db.prepare('SELECT circular,email,digest FROM notification_preferences WHERE user_id=?').get(userId);
    return { circular: row ? Boolean(row.circular) : true, email: row ? Boolean(row.email) : true, digest: row?.digest || 'instant' };
  }

  logDelivery(userId, circularId, channel, status) {
    if (this.closed || !this.db.open) return;
    this.db.prepare('INSERT INTO delivery_log(user_id,circular_id,channel,status,created_at) VALUES(?,?,?,?,?)').run(userId, circularId, channel, status, utcNow());
  }

  async processDigests({ now = Date.now(), force = false } = {}) {
    if (this.disabled || this.closed || this.digestRunning) return { sent: 0 };
    this.digestRunning = true;
    let sent = 0;
    try {
      const users = this.db.prepare(`SELECT u.id,u.email,u.role,u.disabled,min(q.created_at) oldest,r.last_sent_at
        FROM digest_queue q JOIN users u ON u.id=q.user_id LEFT JOIN digest_runs r ON r.user_id=u.id GROUP BY u.id LIMIT 200`).all();
      for (const recipient of users) {
        if (this.closed) break;
        const prefs = this.preferencesFor(recipient.id);
        if (recipient.disabled || !prefs.circular || !prefs.email) {
          this.db.prepare('DELETE FROM digest_queue WHERE user_id=?').run(recipient.id);
          continue;
        }
        const latest = Math.max(Date.parse(recipient.oldest), Date.parse(recipient.last_sent_at || '') || 0);
        if (!force && now - latest < 24 * 60 * 60 * 1000) continue;
        const queued = this.db.prepare('SELECT circular_id FROM digest_queue WHERE user_id=? ORDER BY created_at,circular_id LIMIT 100').all(recipient.id);
        const circulars = queued.filter((row) => userCanReceiveCircular(this.db, recipient.id, row.circular_id)).map((row) => hydrateCircular(this.db, row.circular_id));
        if (circulars.length) {
          try {
            const info = await this.mailer.sendMail({
              from: this.env.MAIL_FROM || 'CampusRelay <no-reply@notifycircular.local>', to: recipient.email,
              subject: `CampusRelay daily digest · ${circulars.length} circular${circulars.length === 1 ? '' : 's'}`,
              text: circulars.map((c) => `${c.summary}\n${c.text}`).join('\n\n———\n\n'),
              html: circulars.map((c) => `<section><h2>${htmlEscape(c.summary)}</h2><p>${htmlEscape(c.text).replace(/\n/g, '<br>')}</p></section>`).join(''),
            });
            if (this.closed) break;
            if (this.emailMode === 'local-preview' && info.message) {
              this.previewMessages.push(String(info.message));
              if (this.previewMessages.length > 20) this.previewMessages.shift();
            }
            for (const circular of circulars) this.logDelivery(recipient.id, circular.id, 'digest', this.emailMode === 'smtp' ? 'sent' : 'preview');
            sent += 1;
          } catch {
            for (const circular of circulars) this.logDelivery(recipient.id, circular.id, 'digest', 'failed');
            continue;
          }
        }
        this.db.transaction(() => {
          for (const row of queued) this.db.prepare('DELETE FROM digest_queue WHERE user_id=? AND circular_id=?').run(recipient.id, row.circular_id);
          if (circulars.length) this.db.prepare('INSERT INTO digest_runs(user_id,last_sent_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET last_sent_at=excluded.last_sent_at').run(recipient.id, new Date(now).toISOString());
        })();
      }
      return { sent };
    } finally { this.digestRunning = false; }
  }

  startDigestScheduler() {
    if (this.digestTimer || this.disabled || this.closed) return;
    const run = () => this.processDigests().catch(() => {});
    this.digestTimer = setInterval(run, 60 * 60 * 1000);
    this.digestTimer.unref?.();
    void run();
  }

  close() {
    this.closed = true;
    if (this.digestTimer) clearInterval(this.digestTimer);
    this.digestTimer = null;
  }
}

module.exports = { NotificationService, createMailer };
