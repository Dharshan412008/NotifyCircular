// Explicitly approved Railway password recovery. Never logs passwords or hashes.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { resolveDatabasePath } = require('../src/db');
async function resetAccounts(filename, payload, operation) {
  if (!/^[a-z0-9-]{10,80}$/.test(operation)) throw new Error('Invalid recovery operation.');
  const marker = path.join(path.dirname(filename), operation + '.completed.json');
  if (fs.existsSync(marker)) return { alreadyCompleted:true };
  const expected = {'admin@demo.edu':'admin','ldharshan2008@gmail.com':'student','balaaravinth.dev@gmail.com':'faculty'};
  if (!payload || Object.keys(payload).length !== 3 || Object.keys(expected).some(email => !/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(payload[email] || ''))) throw new Error('Invalid recovery data.');
  const db = new Database(filename, {fileMustExist:true});
  db.pragma('foreign_keys=ON'); db.pragma('busy_timeout=10000');
  try {
    const unavailable = [];
    const rows = Object.entries(expected).flatMap(([email,role]) => {
      const row = db.prepare('SELECT id,email,role,disabled FROM users WHERE email=?').get(email);
      if (!row || row.role !== role || row.disabled) { unavailable.push({email,expectedRole:role,reason:!row?'not_found':row.disabled?'disabled':'different_role',actualRole:row?.role || null}); return []; }
      return [row];
    });
    const folder=path.join(path.dirname(filename),'backups'); fs.mkdirSync(folder,{recursive:true});
    const backup=path.join(folder,'before-password-reset-'+Date.now()+'.db'); await db.backup(backup);
    db.transaction(()=>{
      for(const row of rows) db.prepare('UPDATE users SET password_hash=? WHERE id=? AND email=? AND role=?').run(payload[row.email],row.id,row.email,row.role);
      const ids=new Set(rows.map(r=>r.id));
      for(const s of db.prepare('SELECT sid,session_json FROM sessions').all()) {
        let value;try{value=JSON.parse(s.session_json);}catch{continue;}
        if(ids.has(Number(value.userId))) db.prepare('DELETE FROM sessions WHERE sid=?').run(s.sid);
      }
      if(db.pragma('foreign_key_check').length) throw new Error('Foreign key check failed.');
    })();
    const result={reset:rows.map(({email,role})=>({email,role})),unavailable,backup};
    fs.writeFileSync(marker,JSON.stringify(result),{mode:0o600});return result;
  } finally {db.close();}
}
module.exports={resetAccounts};
if(require.main===module){
  const filename=resolveDatabasePath(process.env.DB_PATH);
  if(!filename.startsWith('/app/data/')) throw new Error('Refusing non-volume production database.');
  let data;try{data=JSON.parse(process.env.CAMPUSRELAY_RECOVERY_HASHES||'{}');}catch{throw new Error('Invalid recovery input.');}
  resetAccounts(filename,data,'password-recovery-2026-10-24-three-accounts').then(r=>console.log('PASSWORD_RECOVERY_RESULT '+JSON.stringify(r))).catch(e=>{console.error('PASSWORD_RECOVERY_ERROR '+e.message);process.exitCode=1;});
}
