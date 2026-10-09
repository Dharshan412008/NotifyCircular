'use strict';
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { utcNow } = require('./db');
const { assert, asyncRoute } = require('./errors');

function configureGoogleAuth(app, db, env, options) {
  const localAuth = env.AUTH_MODE !== 'google';
  const collegePasswordAuth = env.AUTH_MODE === 'college';
  const domains = (env.COLLEGE_EMAIL_DOMAINS || 'srishakthi.ac.in').split(',').map((s) => s.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  const origin = env.APP_URL || 'http://127.0.0.1:5173';
  const redirectUri = new URL('/api/auth/google/callback', origin).href;
  const ready = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && domains.length);
  const fetchGoogle = options.googleFetch || fetch;
  db.exec('CREATE TABLE IF NOT EXISTS google_identities (subject TEXT PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE)');
  app.get('/api/auth/options', (_req, res) => res.json({ localAuth, collegePasswordAuth, googleEnabled: ready, domains: collegePasswordAuth ? ['srishakthi.ac.in'] : localAuth ? [] : domains }));
  app.get('/api/auth/google/start', asyncRoute(async (req, res) => {
    assert(ready, 503, 'google_not_configured', 'College Google sign-in is not configured yet.');
    const role = req.query.role;
    assert(['student', 'faculty', 'admin'].includes(role), 400, 'invalid_role', 'Choose a portal first.');
    const state = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(32).toString('base64url');
    req.session.googleLogin = { state, verifier, role, expiresAt: Date.now() + 10 * 60_000 };
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    const query = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'select_account' });
    if (domains.length === 1) query.set('hd', domains[0]);
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${query}`);
  }));
  app.get('/api/auth/google/callback', asyncRoute(async (req, res) => {
    const pending = req.session.googleLogin;
    delete req.session.googleLogin;
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    const role = pending?.role || 'student';
    function fail(code) { return res.redirect(new URL(`/${role}?authError=${code}`, origin).href); }
    if (!ready || !pending || pending.expiresAt < Date.now() || typeof req.query.state !== 'string' || req.query.state !== pending.state) return fail('expired');
    if (req.query.error || typeof req.query.code !== 'string') return fail('cancelled');
    try {
      const response = await fetchGoogle('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: req.query.code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: pending.verifier }).toString() });
      if (!response.ok) return fail('verification');
      const token = await response.json();
      if (typeof token.access_token !== 'string') return fail('verification');
      // Obtain identity directly from Google over TLS using the code-bound access token.
      // Never accept a browser-supplied profile or merely decode an unverified ID token.
      const profileResponse = await fetchGoogle('https://openidconnect.googleapis.com/v1/userinfo', { signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${token.access_token}` } });
      if (!profileResponse.ok) return fail('verification');
      const profile = await profileResponse.json();
      const email = typeof profile.email === 'string' ? profile.email.toLowerCase() : '';
      if (profile.email_verified !== true || typeof profile.sub !== 'string' || !profile.sub || profile.sub.length > 255 || !domains.includes(String(profile.hd || '').toLowerCase()) || !domains.includes(email.split('@')[1]) || email.split('@').length !== 2) return fail('college_email');
      let row = db.prepare('SELECT * FROM users WHERE email=?').get(email);
      const identity = db.prepare('SELECT user_id FROM google_identities WHERE subject=?').get(profile.sub);
      if (identity && (!row || identity.user_id !== row.id)) return fail('account');
      if (row && (row.disabled || row.role !== role)) return fail(row.disabled ? 'account' : 'role');
      if (!row && (role !== 'student' || !require('./admin').getCollegeConfig(db).registrationOpen)) return fail('approval');
      const existingLink = row && db.prepare('SELECT subject FROM google_identities WHERE user_id=?').get(row.id);
      if (existingLink && existingLink.subject !== profile.sub) return fail('account');
      if (!row) {
        const hash = await bcrypt.hash(crypto.randomBytes(48).toString('base64url'), 10);
        const name = String(profile.name || email.split('@')[0]).trim().slice(0, 100).padEnd(2, '.');
        const id = db.transaction(() => {
          const result = db.prepare("INSERT INTO users(name,email,password_hash,role,year,created_at) VALUES(?,?,?,'student',NULL,?)").run(name, email, hash, utcNow());
          const userId = Number(result.lastInsertRowid);
          db.prepare("INSERT INTO student_group_memberships(student_id,group_id,source,joined_at) SELECT ?,id,'automatic',? FROM groups WHERE kind='broadcast'").run(userId, utcNow());
          db.prepare('INSERT INTO google_identities(subject,user_id) VALUES(?,?)').run(profile.sub, userId);
          return userId;
        })();
        row = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      } else if (!existingLink) db.prepare('INSERT INTO google_identities(subject,user_id) VALUES(?,?)').run(profile.sub, row.id);
      await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
      req.session.userId = row.id;
      req.session.authProvider = 'google';
      await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
      require('./admin').audit(db, { actorId: row.id, action: 'google.login', resource: 'user', resourceId: row.id });
      return res.redirect(new URL(role === 'faculty' ? '/faculty/compose' : `/${role}`, origin).href);
    } catch { return fail('verification'); }
  }));
  return { localAuth, collegePasswordAuth };
}
module.exports = { configureGoogleAuth };
