// Creates only the two portal accounts explicitly approved by the project owner.
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const Database=require('better-sqlite3');
const {resolveDatabasePath}=require('../src/db');
async function createApproved(filename, hashes, operation) {
  if(!/^[a-z0-9-]{10,80}$/.test(operation)) throw new Error('Invalid operation.');
  const marker=path.join(path.dirname(filename),operation+'.completed.json');
  if(fs.existsSync(marker)) return {alreadyCompleted:true};
  const requested=[{email:'admin@demo.edu',role:'admin',name:'Campus Administrator',department:''},{email:'balaaravinth.dev@gmail.com',role:'faculty',name:'Bala Aravinth',department:'IT'}];
  if(!hashes||Object.keys(hashes).length!==2||requested.some(r=>!/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(hashes[r.email]||''))) throw new Error('Invalid password data.');
  const db=new Database(filename,{fileMustExist:true});db.pragma('foreign_keys=ON');db.pragma('busy_timeout=10000');
  try {
    for(const r of requested) if(db.prepare('SELECT 1 FROM users WHERE email=?').get(r.email)) throw new Error('Account already exists; refusing to overwrite: '+r.email);
    const folder=path.join(path.dirname(filename),'backups');fs.mkdirSync(folder,{recursive:true});const backup=path.join(folder,'before-portal-account-creation-'+Date.now()+'.db');await db.backup(backup);
    db.transaction(()=>{
      for(const r of requested){
        const result=db.prepare('INSERT INTO users(name,email,password_hash,role,year,created_at) VALUES(?,?,?,?,NULL,?)').run(r.name,r.email,hashes[r.email],r.role,new Date().toISOString());
        db.prepare('INSERT INTO user_profiles(user_id,department) VALUES(?,?)').run(result.lastInsertRowid,r.department);
      }
      if(db.pragma('foreign_key_check').length)throw new Error('Foreign key check failed.');
    })();
    const result={created:requested.map(({email,role,department})=>({email,role,department})),backup};fs.writeFileSync(marker,JSON.stringify(result),{mode:0o600});return result;
  } finally {db.close();}
}
module.exports={createApproved};
if(require.main===module){const filename=resolveDatabasePath(process.env.DB_PATH);if(!filename.startsWith('/app/data/'))throw new Error('Refusing non-volume database.');let hashes;try{hashes=JSON.parse(process.env.CAMPUSRELAY_PROVISION_HASHES||'{}');}catch{throw new Error('Invalid provisioning input.');}createApproved(filename,hashes,'approved-admin-faculty-creation-2026-10-24').then(r=>console.log('PORTAL_CREATION_RESULT '+JSON.stringify(r))).catch(e=>{console.error('PORTAL_CREATION_ERROR '+e.message);process.exitCode=1;});}
