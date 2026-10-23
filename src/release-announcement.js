'use strict';
const RELEASE_ID = '2026-10-registration-profiles';
const TITLE = 'CampusRelay update is ready';
const MESSAGE = 'Student and faculty registration details, saved profiles, faculty demo access, and mobile improvements are live. Save your work, then reopen or reload CampusRelay to get the update.';

function createReleaseAnnouncement(db, service) {
  db.exec(`CREATE TABLE IF NOT EXISTS app_release_announcements(release_id TEXT PRIMARY KEY,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS app_release_push_jobs(
      release_id TEXT NOT NULL REFERENCES app_release_announcements(release_id),
      subscription_id INTEGER NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(release_id,subscription_id));`);
  function announce() {
    return db.transaction(() => {
      const created = db.prepare('INSERT OR IGNORE INTO app_release_announcements VALUES(?,?)').run(RELEASE_ID, new Date().toISOString());
      if (!created.changes) return false;
      db.prepare(`INSERT OR IGNORE INTO platform_notifications(user_id,kind,title,message,href,source_key,created_at)
        SELECT id,'app-update',?,?, '/',?,? FROM users WHERE disabled=0`)
        .run(TITLE, MESSAGE, `app-release:${RELEASE_ID}`, new Date().toISOString());
      db.prepare(`INSERT INTO app_release_push_jobs(release_id,subscription_id,user_id)
        SELECT ?,s.id,s.user_id FROM push_subscriptions s JOIN users u ON u.id=s.user_id
        LEFT JOIN notification_preferences p ON p.user_id=u.id
        WHERE u.disabled=0 AND coalesce(p.circular,1)=1 AND (s.expiration_time IS NULL OR s.expiration_time>?)`).run(RELEASE_ID, Date.now());
      return true;
    })();
  }
  let running = false, closed = false, timer;
  async function process() {
    if (closed || running || !service.allowPush || service.disabled) return;
    running = true;
    try {
      const jobs = db.prepare(`SELECT j.user_id,j.subscription_id,s.id,s.endpoint,s.expiration_time,s.p256dh,s.auth,u.disabled,coalesce(p.circular,1) permitted
        FROM app_release_push_jobs j JOIN push_subscriptions s ON s.id=j.subscription_id
        JOIN users u ON u.id=j.user_id LEFT JOIN notification_preferences p ON p.user_id=j.user_id
        WHERE j.release_id=? AND j.status='pending' AND j.attempts<3 LIMIT 25`).all(RELEASE_ID);
      for (const job of jobs) {
        if (closed) break;
        const valid = !job.disabled && job.permitted && job.user_id === db.prepare('SELECT user_id FROM push_subscriptions WHERE id=?').get(job.subscription_id)?.user_id && (!job.expiration_time || job.expiration_time>Date.now());
        if (!valid) {
          db.prepare("UPDATE app_release_push_jobs SET status='cancelled' WHERE release_id=? AND subscription_id=?").run(RELEASE_ID, job.subscription_id);
          continue;
        }
        db.prepare('UPDATE app_release_push_jobs SET attempts=attempts+1 WHERE release_id=? AND subscription_id=?').run(RELEASE_ID, job.subscription_id);
        const status = await service.sendAppUpdate(job, { type: 'app:update', title: TITLE, body: MESSAGE, tag: `app-release:${RELEASE_ID}`, url: '/' });
        if (closed) break;
        db.prepare('UPDATE app_release_push_jobs SET status=? WHERE release_id=? AND subscription_id=?').run(status, RELEASE_ID, job.subscription_id);
      }
    } finally { running = false; }
  }
  return {
    id: RELEASE_ID, announce, process,
    start() {
      if (timer || closed) return;
      timer = setInterval(() => { void process().catch(() => {}); }, 60000);
      timer.unref?.();
      void process().catch(() => {});
    },
    close() { closed = true; if (timer) clearInterval(timer); },
  };
}
module.exports = { createReleaseAnnouncement, RELEASE_ID };
