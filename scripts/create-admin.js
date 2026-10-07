'use strict';
const bcrypt = require('bcryptjs');
const { openDatabase } = require('../src/db');
const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters).');
  process.exitCode = 1;
} else {
  const db = openDatabase({ seed: false });
  try {
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new Error('This email already exists. Existing accounts are never overwritten.');
    db.prepare("INSERT INTO users(name,email,password_hash,role,year,created_at) VALUES(?,?,?,'admin',NULL,?)").run(process.env.ADMIN_NAME || 'College administrator', email, bcrypt.hashSync(password, 12), new Date().toISOString());
    console.log('Administrator created. Sign in at /admin.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { db.close(); }
}
