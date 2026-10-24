// One-time production maintenance. Run only as an explicitly approved startup task.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { resolveDatabasePath } = require('../src/db');
const { removeAllAccounts } = require('./remove-all-accounts.cjs');
(async () => {
  const filename = resolveDatabasePath(process.env.DB_PATH);
  if (!filename.startsWith('/app/data/')) throw new Error('Refusing a database outside the confirmed production volume.');
  const marker = path.join(path.dirname(filename), 'all-account-reset-2026-10-24-approved.json');
  if (fs.existsSync(marker)) { console.log('ACCOUNT_RESET_ALREADY_PROCESSED'); return; }
  const result = await removeAllAccounts(filename, true);
  fs.writeFileSync(marker, JSON.stringify({ completedAt:new Date().toISOString(), ...result }), {mode:0o600});
  console.log('ACCOUNT_RESET_RESULT ' + JSON.stringify(result));
})().catch(error => { console.error('ACCOUNT_RESET_ERROR ' + error.message); process.exitCode=1; });
