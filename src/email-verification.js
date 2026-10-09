'use strict';
const crypto = require('node:crypto');
const nodemailer = require('nodemailer');
const { assert, asyncRoute, ApiError } = require('./errors');
const { serializeUser } = require('./repository');

function configureEmailVerification(app, db, env, options, enabled) {
  db.exec(`CREATE TABLE IF NOT EXISTS email_verifications (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email TEXT, verified_at TEXT, code_hash TEXT, expires_at INTEGER, attempts INTEGER DEFAULT 0,
    sent_at INTEGER DEFAULT 0, session_id TEXT
  )`);
  if (!db.prepare('PRAGMA table_info(email_verifications)').all().some((column) => column.name === 'email')) db.exec('ALTER TABLE email_verifications ADD COLUMN email TEXT');
  const verified = (id) => Boolean(db.prepare('SELECT v.verified_at FROM email_verifications v JOIN users u ON u.id=v.user_id AND u.email=v.email WHERE v.user_id=?').get(id)?.verified_at);
  const transport = options.verificationTransport || (env.SMTP_HOST ? nodemailer.createTransport({
    host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), secure: env.SMTP_SECURE === 'true',
    requireTLS: env.SMTP_SECURE !== 'true', connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } } : {}),
  }) : null);
  const hash = (code, sessionId) => crypto.createHmac('sha256', app.get('verificationSecret')).update(sessionId + ':' + code).digest('hex');
  app.set('verificationSecret', crypto.randomBytes(32));
  function assertReady() {
    assert(transport && env.MAIL_FROM, 400, 'email_delivery_unavailable', 'Email verification delivery is not configured. Contact your administrator.');
  }
  async function send(req, user) {
    assertReady();
    const previous = db.prepare('SELECT sent_at FROM email_verifications WHERE user_id=?').get(user.id);
    assert(!previous || Date.now() - previous.sent_at >= 60000, 429, 'resend_wait', 'Wait one minute before requesting another code.');
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    db.prepare(`INSERT INTO email_verifications(user_id,email,code_hash,expires_at,attempts,sent_at,session_id)
      VALUES(?,?,?,?,0,?,?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,verified_at=NULL,code_hash=excluded.code_hash,
      expires_at=excluded.expires_at,attempts=0,sent_at=excluded.sent_at,session_id=excluded.session_id`)
      .run(user.id, user.email, hash(code, req.sessionID), Date.now() + 10 * 60000, Date.now(), req.sessionID);
    try {
      await transport.sendMail({ from: env.MAIL_FROM, to: user.email, subject: 'CampusRelay email verification',
        text: `Your CampusRelay verification code is ${code}. It expires in 10 minutes. If you did not request this code, ignore this email.` });
    } catch {
      db.prepare('UPDATE email_verifications SET code_hash=NULL,sent_at=0 WHERE user_id=? AND session_id=?').run(user.id, req.sessionID);
      throw new ApiError(400, 'email_delivery_failed', 'The verification email could not be sent. Please try again or contact your administrator.');
    }
    return { verificationRequired: true, email: user.email, expiresInSeconds: 600, resendAfterSeconds: 60 };
  }
  async function begin(req, user) {
    await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
    req.session.pendingVerification = user.id;
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    return send(req, user);
  }
  function pendingUser(req) {
    assert(enabled, 403, 'verification_disabled', 'Email verification is not enabled.');
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.pendingVerification || 0);
    assert(user && !user.disabled && user.email.endsWith('@srishakthi.ac.in'), 401, 'verification_required', 'Sign in again to request a verification code.');
    return user;
  }
  app.post('/api/auth/verification/resend', asyncRoute(async (req, res) => res.json(await send(req, pendingUser(req)))));
  app.post('/api/auth/verification/confirm', asyncRoute(async (req, res) => {
    const user = pendingUser(req);
    const record = db.prepare('SELECT * FROM email_verifications WHERE user_id=?').get(user.id);
    assert(record?.code_hash && record.email === user.email && record.session_id === req.sessionID && record.expires_at > Date.now(), 400, 'code_expired', 'Your code expired. Request a new code.');
    assert(record.attempts < 5, 429, 'too_many_attempts', 'Too many incorrect attempts. Request a new code.');
    db.prepare('UPDATE email_verifications SET attempts=attempts+1 WHERE user_id=?').run(user.id);
    const code = req.body?.code;
    assert(typeof code === 'string' && /^\d{6}$/.test(code) && crypto.timingSafeEqual(Buffer.from(record.code_hash, 'hex'), Buffer.from(hash(code, req.sessionID), 'hex')), 400, 'invalid_code', 'Enter the correct six-digit code from your email.');
    db.prepare('UPDATE email_verifications SET verified_at=?,code_hash=NULL,session_id=NULL WHERE user_id=?').run(new Date().toISOString(), user.id);
    await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
    req.session.userId = user.id;
    res.json({ user: serializeUser(user) });
  }));
  return { verified, begin, assertReady };
}
module.exports = { configureEmailVerification };
