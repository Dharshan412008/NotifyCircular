'use strict';
// EXISTS deduplicates overlapping groups; these metrics follow current access.
const AUDIENCE = `WITH notices AS (
  SELECT c.*,coalesce(nullif(m.title,''),c.summary) title,coalesce(m.category,'general') category
  FROM circulars c LEFT JOIN circular_metadata m ON m.circular_id=c.id
  WHERE c.faculty_id=@facultyId AND c.created_at>=@since AND c.created_at<=@until
), recipients AS (
  SELECT c.id circular_id,u.id user_id,r.read_at,r.acknowledged_at,c.requires_acknowledgment
  FROM notices c JOIN users u ON u.disabled=0 AND (
    (u.role='student' AND EXISTS(SELECT 1 FROM circular_targets t JOIN student_group_memberships m ON m.group_id=t.group_id WHERE t.circular_id=c.id AND m.student_id=u.id))
    OR (u.role='faculty' AND EXISTS(SELECT 1 FROM circular_targets t JOIN groups g ON g.id=t.group_id WHERE t.circular_id=c.id AND g.kind='role'))
  ) LEFT JOIN circular_reads r ON r.circular_id=c.id AND r.student_id=u.id
)`;
function facultyAnalytics(db, facultyId, days = 30, now = new Date()) {
  const until = now.toISOString();
  const start = new Date(until.slice(0, 10) + 'T00:00:00.000Z');
  start.setUTCDate(start.getUTCDate() - days + 1);
  const since = start.toISOString(), args = { facultyId, since, until };
  const totals = db.prepare(`${AUDIENCE} SELECT (SELECT count(*) FROM notices) sent,count(*) recipientOpportunities,
    count(DISTINCT user_id) uniqueRecipients,coalesce(sum(read_at IS NOT NULL),0) read,
    coalesce(sum(requires_acknowledgment=1),0) required,
    coalesce(sum(requires_acknowledgment=1 AND acknowledged_at IS NOT NULL),0) acknowledged FROM recipients`).get(args);
  const summary = { ...totals, pendingRead: totals.recipientOpportunities - totals.read,
    pendingAcknowledgments: totals.required - totals.acknowledged,
    readRate: totals.recipientOpportunities ? Math.round(totals.read / totals.recipientOpportunities * 100) : 0,
    acknowledgmentRate: totals.required ? Math.round(totals.acknowledged / totals.required * 100) : 0 };
  const dailyRows = db.prepare(`${AUDIENCE} SELECT substr(c.created_at,1,10) date,count(DISTINCT c.id) sent,
    count(r.user_id) recipients,coalesce(sum(r.read_at IS NOT NULL),0) read
    FROM notices c LEFT JOIN recipients r ON r.circular_id=c.id GROUP BY date ORDER BY date`).all(args);
  const indexed = new Map(dailyRows.map((row) => [row.date, row]));
  const daily = Array.from({ length: days }, (_, index) => {
    const date = new Date(start); date.setUTCDate(date.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return indexed.get(key) || { date: key, sent: 0, recipients: 0, read: 0 };
  });
  const categories = db.prepare(`${AUDIENCE} SELECT category,count(*) sent FROM notices GROUP BY category ORDER BY sent DESC,category`).all(args);
  const circulars = db.prepare(`${AUDIENCE} SELECT c.id,c.title,c.created_at createdAt,c.category,
    count(r.user_id) audience,coalesce(sum(r.read_at IS NOT NULL),0) read,
    coalesce(sum(c.requires_acknowledgment=1 AND r.user_id IS NOT NULL AND r.acknowledged_at IS NULL),0) pendingAcknowledgments
    FROM notices c LEFT JOIN recipients r ON r.circular_id=c.id GROUP BY c.id ORDER BY c.created_at DESC,c.id DESC LIMIT 100`).all(args);
  return { days, since, until, summary, daily, categories, circulars };
}
module.exports = { facultyAnalytics };
