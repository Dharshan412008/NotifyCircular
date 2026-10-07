'use strict';

const { ApiError } = require('./errors');
const { utcNow } = require('./db');

function serializeUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.role,
    year: row.year === null || row.year === undefined ? null : Number(row.year),
  };
}

function serializeGroup(row) {
  const group = {
    id: Number(row.id),
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: row.icon,
    kind: row.kind,
    joinable: Boolean(row.joinable),
    year: row.year === null || row.year === undefined ? null : Number(row.year),
    department: row.department || '',
    section: row.section || '',
    parentGroupId: row.parent_group_id === null || row.parent_group_id === undefined ? null : Number(row.parent_group_id),
  };
  if (row.is_member !== undefined) group.isMember = Boolean(row.is_member);
  if (row.member_count !== undefined) group.memberCount = Number(row.member_count);
  return group;
}

function listGroups(db, user) {
  const rows = db
    .prepare(`
      SELECT
        g.*,
        CASE
          WHEN @userRole = 'faculty' AND g.kind = 'role' THEN 1
          ELSE EXISTS (
            SELECT 1 FROM student_group_memberships own_membership
            WHERE own_membership.group_id = g.id
              AND own_membership.student_id = @userId
          )
        END AS is_member,
        CASE
          WHEN g.kind = 'role' THEN (
            SELECT count(*) FROM users role_members WHERE role_members.role = 'faculty'
          )
          ELSE (
            SELECT count(*) FROM student_group_memberships all_memberships
            WHERE all_memberships.group_id = g.id
          )
        END AS member_count
      FROM groups g
      ORDER BY
        CASE g.kind
          WHEN 'year' THEN 1
          WHEN 'activity' THEN 2
          WHEN 'custom' THEN 3
          WHEN 'role' THEN 4
          WHEN 'broadcast' THEN 5
        END,
        g.name COLLATE NOCASE
    `)
    .all({ userId: user?.id || -1, userRole: user?.role || '' });

  return rows.map((row) => {
    const group = serializeGroup(row);
    if (user?.role !== 'faculty') delete group.memberCount;
    return group;
  });
}

function getGroup(db, id) {
  const row = db
    .prepare(`
      SELECT g.*, CASE
        WHEN g.kind = 'role' THEN (
          SELECT count(*) FROM users role_members WHERE role_members.role = 'faculty'
        )
        ELSE (
          SELECT count(*) FROM student_group_memberships m WHERE m.group_id = g.id
        )
      END AS member_count
      FROM groups g WHERE g.id = ?
    `)
    .get(id);
  return row ? serializeGroup(row) : null;
}

function getMembershipGroups(db, studentId) {
  return db
    .prepare(`
      SELECT g.*, 1 AS is_member
      FROM groups g
      JOIN student_group_memberships m ON m.group_id = g.id
      WHERE m.student_id = ?
      ORDER BY g.name COLLATE NOCASE
    `)
    .all(studentId)
    .map(serializeGroup);
}

function circularBaseRow(db, circularId) {
  return db
    .prepare(`
      SELECT
        c.*,
        u.id AS faculty_user_id,
        u.name AS faculty_name,
        u.email AS faculty_email
      FROM circulars c
      JOIN users u ON u.id = c.faculty_id
      WHERE c.id = ?
    `)
    .get(circularId);
}

function circularTargets(db, circularId) {
  return db
    .prepare(`
      SELECT g.*
      FROM groups g
      JOIN circular_targets ct ON ct.group_id = g.id
      WHERE ct.circular_id = ?
      ORDER BY g.name COLLATE NOCASE
    `)
    .all(circularId)
    .map(serializeGroup);
}

function audienceRows(db, circularId) {
  return db
    .prepare(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        u.year,
        cr.read_at,
        cr.acknowledged_at
      FROM users u
      LEFT JOIN circular_reads cr
        ON cr.student_id = u.id AND cr.circular_id = @circularId
      WHERE u.disabled = 0 AND ((
        u.role = 'student'
        AND EXISTS (
          SELECT 1
          FROM student_group_memberships m
          JOIN circular_targets ct ON ct.group_id = m.group_id
          WHERE m.student_id = u.id
            AND ct.circular_id = @circularId
        )
      ) OR (
        u.role = 'faculty'
        AND EXISTS (
          SELECT 1
          FROM circular_targets ct
          JOIN groups g ON g.id = ct.group_id
          WHERE ct.circular_id = @circularId
            AND g.kind = 'role'
        )
      )
      ) ORDER BY u.name COLLATE NOCASE, u.id
    `)
    .all({ circularId });
}

function accountabilityFromRows(rows, requiresAcknowledgment) {
  const read = rows.filter((row) => row.read_at).length;
  const acknowledged = rows.filter((row) => row.acknowledged_at).length;
  return {
    audience: rows.length,
    read,
    pendingRead: rows.length - read,
    acknowledged,
    pendingAcknowledgment: requiresAcknowledgment ? rows.length - acknowledged : 0,
  };
}

function serializeCircularRow(row) {
  return {
    id: Number(row.id),
    text: row.text,
    createdAt: row.created_at,
    detectedDate: row.detected_date || null,
    detectedDateText: row.detected_date_text || null,
    urgency: row.urgency,
    summary: row.summary,
    requiresAcknowledgment: Boolean(row.requires_acknowledgment),
    faculty: {
      id: Number(row.faculty_user_id),
      name: row.faculty_name,
      email: row.faculty_email,
    },
  };
}

function hydrateCircular(db, rowOrId, options = {}) {
  const row = typeof rowOrId === 'object' ? rowOrId : circularBaseRow(db, rowOrId);
  if (!row) return null;
  const circular = serializeCircularRow(row);
  circular.targets = circularTargets(db, circular.id);

  const recipientId = options.recipientId || options.studentId;
  if (recipientId) {
    const status = db
      .prepare(`
        SELECT read_at, acknowledged_at
        FROM circular_reads
        WHERE circular_id = ? AND student_id = ?
      `)
      .get(circular.id, recipientId);
    circular.readAt = status?.read_at || null;
    circular.acknowledgedAt = status?.acknowledged_at || null;
    circular.saved = Boolean(db.prepare('SELECT 1 FROM saved_circulars WHERE user_id=? AND circular_id=?').get(recipientId, circular.id));
  }

  if (options.includeStats || options.includeRecipients) {
    const rows = audienceRows(db, circular.id);
    circular.stats = accountabilityFromRows(rows, circular.requiresAcknowledgment);
    if (options.includeRecipients) {
      circular.recipients = rows.map((recipient) => ({
        ...serializeUser(recipient),
        readAt: recipient.read_at || null,
        acknowledgedAt: recipient.acknowledged_at || null,
      }));
    }
  }
  Object.assign(circular, require('./circular-tools').getCircularExtras(db, circular.id));
  return circular;
}

function userCanReceiveCircular(db, userId, circularId) {
  return Boolean(
    db
      .prepare(`
        SELECT 1
        FROM users u
        WHERE u.id = @userId AND u.disabled = 0
          AND (
            (
              u.role = 'student'
              AND EXISTS (
                SELECT 1
                FROM circular_targets ct
                JOIN student_group_memberships m ON m.group_id = ct.group_id
                WHERE ct.circular_id = @circularId AND m.student_id = u.id
              )
            ) OR (
              u.role = 'faculty'
              AND EXISTS (
                SELECT 1
                FROM circular_targets ct
                JOIN groups g ON g.id = ct.group_id
                WHERE ct.circular_id = @circularId AND g.kind = 'role'
              )
            )
          )
        LIMIT 1
      `)
      .get({ circularId, userId }),
  );
}

function studentCanAccessCircular(db, studentId, circularId) {
  return userCanReceiveCircular(db, studentId, circularId);
}

function listStudentInbox(db, studentId, options = {}) {
  const parameters = {
    studentId,
    limit: options.limit || 100,
    offset: options.offset || 0,
    groupId: options.groupId || null,
  };
  const rows = db
    .prepare(`
      SELECT DISTINCT
        c.*,
        u.id AS faculty_user_id,
        u.name AS faculty_name,
        u.email AS faculty_email
      FROM circulars c
      JOIN users u ON u.id = c.faculty_id
      JOIN circular_targets ct ON ct.circular_id = c.id
      JOIN student_group_memberships m
        ON m.group_id = ct.group_id AND m.student_id = @studentId
      WHERE (@groupId IS NULL OR ct.group_id = @groupId)
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT @limit OFFSET @offset
    `)
    .all(parameters);
  return rows.map((row) => hydrateCircular(db, row, { studentId }));
}

function listFacultyCirculars(db, facultyId, options = {}) {
  const rows = db
    .prepare(`
      SELECT
        c.*,
        u.id AS faculty_user_id,
        u.name AS faculty_name,
        u.email AS faculty_email
      FROM circulars c
      JOIN users u ON u.id = c.faculty_id
      WHERE c.faculty_id = @facultyId
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT @limit OFFSET @offset
    `)
    .all({ facultyId, limit: options.limit || 100, offset: options.offset || 0 });
  return rows.map((row) => hydrateCircular(db, row, { includeStats: true }));
}

function listFacultyInbox(db, facultyId, options = {}) {
  const rows = db
    .prepare(`
      SELECT DISTINCT
        c.*,
        u.id AS faculty_user_id,
        u.name AS faculty_name,
        u.email AS faculty_email
      FROM circulars c
      JOIN users u ON u.id = c.faculty_id
      JOIN circular_targets ct ON ct.circular_id = c.id
      JOIN groups g ON g.id = ct.group_id
      WHERE g.kind = 'role'
        AND (@groupId IS NULL OR g.id = @groupId)
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT @limit OFFSET @offset
    `)
    .all({
      groupId: options.groupId || null,
      limit: options.limit || 100,
      offset: options.offset || 0,
    });
  return rows.map((row) => hydrateCircular(db, row, { recipientId: facultyId }));
}

function createCircular(db, input) {
  return db.transaction(() => {
    const result = db
      .prepare(`
        INSERT INTO circulars (
          faculty_id,
          text,
          created_at,
          detected_date,
          detected_date_text,
          urgency,
          summary,
          requires_acknowledgment
        ) VALUES (
          @facultyId,
          @text,
          @createdAt,
          @detectedDate,
          @detectedDateText,
          @urgency,
          @summary,
          @requiresAcknowledgment
        )
      `)
      .run({
        ...input,
        createdAt: input.createdAt || utcNow(),
        requiresAcknowledgment: input.requiresAcknowledgment ? 1 : 0,
      });
    const circularId = Number(result.lastInsertRowid);
    const addTarget = db.prepare(
      'INSERT INTO circular_targets (circular_id, group_id) VALUES (?, ?)',
    );
    for (const groupId of input.targetGroupIds) addTarget.run(circularId, groupId);
    return hydrateCircular(db, circularId, { includeStats: true });
  })();
}

function markCircular(db, circularId, recipientId, acknowledge = false) {
  if (!userCanReceiveCircular(db, recipientId, circularId)) {
    throw new ApiError(404, 'circular_not_found', 'Circular was not found in your inbox.');
  }
  const now = utcNow();
  db.prepare(`
    INSERT INTO circular_reads (circular_id, student_id, read_at, acknowledged_at)
    VALUES (@circularId, @studentId, @now, @acknowledgedAt)
    ON CONFLICT(circular_id, student_id) DO UPDATE SET
      read_at = coalesce(circular_reads.read_at, excluded.read_at),
      acknowledged_at = CASE
        WHEN @acknowledgedAt IS NOT NULL
          THEN coalesce(circular_reads.acknowledged_at, excluded.acknowledged_at)
        ELSE circular_reads.acknowledged_at
      END
  `).run({
    circularId,
    studentId: recipientId,
    now,
    acknowledgedAt: acknowledge ? now : null,
  });
  const status = db
    .prepare(`
      SELECT read_at, acknowledged_at
      FROM circular_reads
      WHERE circular_id = ? AND student_id = ?
    `)
    .get(circularId, recipientId);
  return { readAt: status.read_at, acknowledgedAt: status.acknowledged_at || null };
}

module.exports = {
  serializeUser,
  serializeGroup,
  listGroups,
  getGroup,
  getMembershipGroups,
  circularBaseRow,
  circularTargets,
  audienceRows,
  hydrateCircular,
  userCanReceiveCircular,
  studentCanAccessCircular,
  listStudentInbox,
  listFacultyCirculars,
  listFacultyInbox,
  createCircular,
  markCircular,
};
