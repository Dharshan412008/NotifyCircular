// Maintenance tool: dry run by default; never deletes the SQLite file or groups.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { resolveDatabasePath } = require('../src/db');
async function removeAllAccounts(filename, apply = false) {
  const db = new Database(filename, { fileMustExist: true, readonly: !apply });
  db.pragma('foreign_keys=ON'); db.pragma('busy_timeout=10000');
  try {
    const accounts = db.prepare('SELECT id,email,role FROM users ORDER BY id').all();
    if (!apply) return { dryRun:true, accounts };
    const folder = path.join(path.dirname(filename), 'backups');
    fs.mkdirSync(folder, { recursive:true });
    const backup = path.join(folder, 'before-all-account-removal-' + Date.now() + '.db');
    await db.backup(backup);
    const blockers = [];
    for (const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
      const q = '"' + name.replaceAll('"','""') + '"';
      for (const fk of db.prepare('PRAGMA foreign_key_list(' + q + ')').all()) {
        if (fk.table !== 'users' || !['RESTRICT','NO ACTION'].includes(fk.on_delete)) continue;
        const col = '"' + fk.from.replaceAll('"','""') + '"';
        const n = db.prepare('SELECT count(*) n FROM ' + q + ' WHERE ' + col + ' IN (SELECT id FROM users)').get().n;
        if (n) blockers.push({table:name, count:n});
      }
    }
    if (blockers.length) return { removed:0, blocked:true, backup, blockers };
    db.transaction(() => {
      db.prepare('DELETE FROM sessions').run();
      db.prepare('DELETE FROM users').run();
      db.prepare("INSERT INTO settings(key,value) VALUES('demo_seed_disabled','true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
      if (db.prepare('SELECT count(*) n FROM users').get().n) throw new Error('Accounts remain.');
      if (db.pragma('foreign_key_check').length) throw new Error('Foreign key check failed.');
      if (db.pragma('integrity_check', {simple:true}) !== 'ok') throw new Error('Integrity check failed.');
    })();
    return { removed:accounts.length, remaining:0, backup, integrity:'ok' };
  } finally { db.close(); }
}
module.exports = { removeAllAccounts };
if (require.main === module) removeAllAccounts(resolveDatabasePath(process.env.DB_PATH), process.argv.includes('--apply')).then(result => { console.log(JSON.stringify(result)); if(result.blocked) process.exitCode=2; }).catch(error => {console.error(error.message); process.exitCode=1;});
