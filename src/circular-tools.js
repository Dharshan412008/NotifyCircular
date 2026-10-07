'use strict';

const crypto = require('node:crypto');
const zlib = require('node:zlib');
const express = require('express');
const { requireAuth, requireRole } = require('./auth');
const { ApiError, assert, asyncRoute } = require('./errors');
const { cleanBoolean, cleanIdArray, cleanInteger, cleanIsoDate, cleanString, requireObject } = require('./validation');
const { createCircular, hydrateCircular, serializeGroup, userCanReceiveCircular } = require('./repository');
const { analyzeText } = require('./classifier');
const { migrateCircularTools } = require('./circular-tools-migration');

const CATEGORIES = ['academic', 'examination', 'placement', 'event', 'scholarship', 'sports', 'club', 'emergency', 'general'];
const PRIORITIES = ['normal', 'important', 'urgent', 'emergency'];
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const TEMPLATES = [
  ['exam', 'Exam notification', 'examination', 'important', 'Examination timetable', 'The examination for [course] will be held on [date] at [venue]. Please bring your college ID and arrive 15 minutes early.'],
  ['placement', 'Placement drive', 'placement', 'important', 'Campus placement drive', 'Applications are open for the [company] placement drive. Eligible students should submit their resume before [deadline].'],
  ['workshop', 'Workshop', 'event', 'normal', 'Workshop registration', 'Join our workshop on [topic] at [venue]. Register before [deadline] and bring [requirements].'],
  ['holiday', 'Holiday', 'general', 'normal', 'College holiday announcement', 'The college will remain closed on [date] for [occasion]. Classes will resume on [date].'],
  ['scholarship', 'Scholarship', 'scholarship', 'important', 'Scholarship applications', 'Applications for [scholarship] are now open. Eligible students should submit the required documents by [deadline].'],
  ['competition', 'Competition', 'club', 'normal', 'Campus competition', 'Register for the [competition] on [date] at [venue]. Teams should submit their entries before [deadline].'],
  ['emergency', 'Emergency notice', 'emergency', 'emergency', 'Important campus safety update', 'Please follow these instructions: [instructions]. Contact [college contact] for help. Await the next official update.'],
].map(([id, name, category, priority, title, text]) => ({ id: `builtin-${id}`, name, builtin: true, payload: { title, text, category, priority, targetGroupIds: [], requiresAcknowledgment: priority === 'emergency', attachmentIds: [], detectedDate: null, eventTime: null, location: '', deadline: null, pinnedUntil: null } }));

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function nullableDate(value, field) {
  return value === undefined || value === null || value === '' ? null : cleanIsoDate(value, field);
}

function normalizeMetadata(input) {
  const body = requireObject(input);
  const category = body.category ?? 'general';
  const priority = body.priority ?? 'normal';
  assert(CATEGORIES.includes(category), 400, 'validation_error', 'Choose a valid circular category.');
  assert(PRIORITIES.includes(priority), 400, 'validation_error', 'Choose normal, important, urgent, or emergency priority.');
  const eventTime = body.eventTime || null;
  assert(eventTime === null || typeof eventTime === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(eventTime), 400, 'validation_error', 'Event time must use HH:mm.');
  return {
    title: cleanString(body.title ?? '', 'title', { max: 240 }),
    category,
    priority,
    eventTime,
    location: cleanString(body.location ?? '', 'location', { max: 240 }),
    deadline: nullableDate(body.deadline, 'deadline'),
    pinnedUntil: nullableDate(body.pinnedUntil, 'pinnedUntil'),
  };
}

function fileMetadata(row) {
  return { id: row.id, name: row.name, mimeType: row.mime_type, size: row.size, url: `/api/circular-tools/attachments/${row.id}` };
}

function getCircularExtras(db, circularId) {
  if (!tableExists(db, 'circular_metadata')) return {};
  const metadata = db.prepare('SELECT * FROM circular_metadata WHERE circular_id = ?').get(circularId);
  const attachments = db.prepare(`SELECT f.id, f.name, f.mime_type, f.size FROM circular_files f JOIN circular_file_links l ON l.file_id = f.id WHERE l.circular_id = ? ORDER BY f.created_at, f.id`).all(circularId).map(fileMetadata);
  const attendanceAvailable = Boolean(db.prepare('SELECT 1 FROM circular_attendance_tokens WHERE circular_id = ? AND revoked_at IS NULL AND expires_at > ?').get(circularId, new Date().toISOString()));
  return {
    ...(metadata ? { title: metadata.title, category: metadata.category, priority: metadata.priority, eventTime: metadata.event_time, location: metadata.location, deadline: metadata.deadline, pinnedUntil: metadata.pinned_until } : {}),
    attachments,
    attendanceAvailable,
  };
}

function cleanAttachmentIds(db, facultyId, value = []) {
  assert(Array.isArray(value) && value.length <= 5, 400, 'validation_error', 'A circular can include up to five attachments.');
  const ids = [...new Set(value.map((id) => cleanString(id, 'attachmentIds', { min: 36, max: 36 })))];
  const get = db.prepare('SELECT 1 FROM circular_files WHERE id = ? AND faculty_id = ?');
  assert(ids.every((id) => get.get(id, facultyId)), 400, 'attachment_not_found', 'An attachment is missing or does not belong to your account.');
  return ids;
}

function normalizePayload(db, facultyId, input, complete = false) {
  const body = requireObject(input, 'Circular');
  const metadata = normalizeMetadata(body);
  const text = cleanString(body.text ?? '', 'text', { min: complete ? 5 : 0, max: 5000 });
  const targetGroupIds = cleanIdArray(body.targetGroupIds ?? [], 'targetGroupIds', { min: complete ? 1 : 0, max: 25 });
  const getGroup = db.prepare('SELECT * FROM groups WHERE id = ?');
  const groups = targetGroupIds.map((id) => getGroup.get(id));
  assert(groups.every((group) => group && !group.archived && !group.archived_at), 400, 'group_not_found', 'One or more target groups are unavailable.');
  const detectedDate = nullableDate(body.detectedDate, 'detectedDate');
  assert(!metadata.eventTime || detectedDate, 400, 'validation_error', 'Choose an event date before setting its time.');
  const requiresAcknowledgment = cleanBoolean(body.requiresAcknowledgment, 'requiresAcknowledgment', ['urgent', 'emergency'].includes(metadata.priority));
  return { ...metadata, text, targetGroupIds, detectedDate, requiresAcknowledgment, attachmentIds: cleanAttachmentIds(db, facultyId, body.attachmentIds) };
}

function storeCircularExtras(db, circularId, metadata, attachmentIds = [], timestamp = new Date().toISOString()) {
  db.prepare(`INSERT INTO circular_metadata (circular_id, title, category, priority, event_time, location, deadline, pinned_until, updated_at)
    VALUES (@id, @title, @category, @priority, @eventTime, @location, @deadline, @pinnedUntil, @now)
    ON CONFLICT(circular_id) DO UPDATE SET title=excluded.title, category=excluded.category, priority=excluded.priority, event_time=excluded.event_time, location=excluded.location, deadline=excluded.deadline, pinned_until=excluded.pinned_until, updated_at=excluded.updated_at`).run({ id: circularId, ...metadata, now: timestamp });
  const link = db.prepare('INSERT OR IGNORE INTO circular_file_links (circular_id, file_id) VALUES (?, ?)');
  for (const id of attachmentIds) link.run(circularId, id);
}

function timestamp(value, field) {
  const input = cleanString(value, field, { min: 20, max: 40 });
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(input), 400, 'validation_error', `${field} must include a date, time, and timezone.`);
  const date = new Date(input);
  assert(Number.isFinite(date.getTime()), 400, 'validation_error', `${field} must be a valid date and time.`);
  return date.toISOString();
}

// Inspect ZIP directory entries without extracting paths to the filesystem. Only a
// bounded Word document package is accepted; a renamed arbitrary ZIP is rejected.
function isDocx(buffer) {
  try {
    let eocd = -1;
    for (let pos = buffer.length - 22; pos >= Math.max(0, buffer.length - 65557); pos -= 1) {
      if (buffer.readUInt32LE(pos) === 0x06054b50) { eocd = pos; break; }
    }
    if (eocd < 0 || buffer.readUInt16LE(eocd + 4) || buffer.readUInt16LE(eocd + 6)) return false;
    const count = buffer.readUInt16LE(eocd + 10);
    if (!count || count > 1500) return false;
    let pos = buffer.readUInt32LE(eocd + 16);
    const entries = new Map();
    let totalSize = 0;
    for (let index = 0; index < count; index += 1) {
      if (pos + 46 > eocd || buffer.readUInt32LE(pos) !== 0x02014b50) return false;
      const flags = buffer.readUInt16LE(pos + 8);
      const method = buffer.readUInt16LE(pos + 10);
      const compressed = buffer.readUInt32LE(pos + 20);
      const size = buffer.readUInt32LE(pos + 24);
      const nameLength = buffer.readUInt16LE(pos + 28);
      const extraLength = buffer.readUInt16LE(pos + 30);
      const commentLength = buffer.readUInt16LE(pos + 32);
      const local = buffer.readUInt32LE(pos + 42);
      const name = buffer.subarray(pos + 46, pos + 46 + nameLength).toString('utf8');
      totalSize += size;
      if (flags & 1 || ![0, 8].includes(method) || name.includes('..') || name.startsWith('/') || name.includes('\\') || /vbaproject/i.test(name) || totalSize > 25 * 1024 * 1024 || entries.has(name)) return false;
      if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) return false;
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      if (start + compressed > buffer.length) return false;
      entries.set(name, { start, compressed, size, method });
      pos += 46 + nameLength + extraLength + commentLength;
    }
    const contentTypes = entries.get('[Content_Types].xml');
    const document = entries.get('word/document.xml');
    if (!contentTypes || !document || contentTypes.size > 65536 || document.size > 10 * 1024 * 1024) return false;
    const readEntry = (entry, maxOutputLength) => entry.method === 8
      ? zlib.inflateRawSync(buffer.subarray(entry.start, entry.start + entry.compressed), { maxOutputLength }).toString('utf8')
      : buffer.subarray(entry.start, entry.start + entry.compressed).toString('utf8');
    const types = readEntry(contentTypes, 65536);
    const xml = readEntry(document, 10 * 1024 * 1024);
    return /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document\.main\+xml/.test(types) && !/macroEnabled/i.test(types) && /<(?:\w+:)?document[\s>]/.test(xml);
  } catch { return false; }
}

function validateAttachment(body, maxBytes) {
  requireObject(body);
  const name = cleanString(body.name, 'name', { min: 1, max: 180 }).split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f]/g, '');
  assert(name && name !== '.' && name !== '..', 400, 'invalid_attachment', 'Choose a file with a valid name.');
  const encoded = cleanString(body.data, 'data', { min: 4, max: Math.ceil(maxBytes / 3) * 4, trim: false });
  assert(encoded.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded), 400, 'invalid_attachment', 'Attachment data must be valid base64.');
  const content = Buffer.from(encoded, 'base64');
  assert(content.length > 0 && content.length <= maxBytes, 413, 'attachment_too_large', `Attachments must be no larger than ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
  let mimeType;
  let extensions;
  if (content.subarray(0, 5).toString('ascii') === '%PDF-' && content.subarray(-1024).includes(Buffer.from('%%EOF'))) {
    mimeType = 'application/pdf'; extensions = ['pdf'];
  } else if (content.length > 24 && content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && content.subarray(12, 16).toString('ascii') === 'IHDR') {
    mimeType = 'image/png'; extensions = ['png'];
  } else if (content.length > 4 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff && content.at(-2) === 0xff && content.at(-1) === 0xd9) {
    mimeType = 'image/jpeg'; extensions = ['jpg', 'jpeg'];
  } else if (content.length >= 30 && content.subarray(0, 4).toString('ascii') === 'RIFF' && content.subarray(8, 12).toString('ascii') === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(content.subarray(12, 16).toString('ascii'))) {
    mimeType = 'image/webp'; extensions = ['webp'];
  } else if (content.length >= 22 && isDocx(content)) {
    mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; extensions = ['docx'];
  }
  assert(mimeType && extensions.includes(name.split('.').at(-1).toLowerCase()), 400, 'invalid_attachment', 'Upload a valid PDF, DOCX, PNG, JPEG, or WebP file with its correct extension.');
  assert(!body.mimeType || body.mimeType === mimeType, 400, 'invalid_attachment', 'The file content does not match its declared type.');
  return { name, content, mimeType };
}

function createCircularTools(options) {
  const { db } = options;
  migrateCircularTools(db);
  const now = options.now || (() => new Date());
  const nowIso = () => new Date(now()).toISOString();
  const publish = options.publishCircular || (() => {});
  const maxAttachmentBytes = options.maxAttachmentBytes || MAX_ATTACHMENT_BYTES;
  assert(Number.isSafeInteger(maxAttachmentBytes) && maxAttachmentBytes > 0 && maxAttachmentBytes <= 20 * 1024 * 1024, 500, 'invalid_configuration', 'Attachment size limit is invalid.');
  const router = express.Router();
  let timer;
  let running = false;
  let closed = false;

  function ownerItem(id, facultyId) {
    const row = db.prepare('SELECT * FROM circular_work_items WHERE id = ? AND faculty_id = ?').get(cleanInteger(id, 'id', { min: 1 }), facultyId);
    if (!row) throw new ApiError(404, 'work_item_not_found', 'This draft, template, or schedule was not found.');
    return row;
  }

  function workItem(row) {
    const payload = JSON.parse(row.payload_json);
    return { id: row.id, kind: row.kind, name: row.name, payload, status: row.status, sendAt: row.send_at, circularId: row.circular_id, error: row.last_error, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  function accessibleCircular(circularId, user, ownerOnly = false) {
    const id = cleanInteger(circularId, 'circularId', { min: 1 });
    const row = db.prepare('SELECT * FROM circulars WHERE id = ?').get(id);
    if (!row || Number(row.faculty_id) !== Number(user.id) && (ownerOnly || !userCanReceiveCircular(db, user.id, id))) throw new ApiError(404, 'circular_not_found', 'Circular was not found.');
    return row;
  }

  function activeFaculty(facultyId) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(facultyId);
    assert(user?.role === 'faculty' && !user.disabled, 409, 'faculty_unavailable', 'The sending faculty account is unavailable.');
  }

  function createPublished(facultyId, payload) {
    activeFaculty(facultyId);
    const validated = normalizePayload(db, facultyId, payload, true);
    const circular = createCircular(db, {
      facultyId,
      text: validated.text,
      targetGroupIds: validated.targetGroupIds,
      detectedDate: validated.detectedDate,
      detectedDateText: null,
      urgency: ['urgent', 'emergency'].includes(validated.priority) ? 'urgent' : 'normal',
      summary: validated.title || analyzeText(validated.text, []).summary,
      requiresAcknowledgment: validated.requiresAcknowledgment,
      createdAt: nowIso(),
    });
    storeCircularExtras(db, circular.id, validated, validated.attachmentIds, nowIso());
    db.prepare('INSERT INTO circular_dispatch_jobs (circular_id, next_attempt_at) VALUES (?, ?)').run(circular.id, nowIso());
    return { ...circular, ...getCircularExtras(db, circular.id) };
  }

  async function flushDispatches() {
    const due = db.prepare(`SELECT circular_id FROM circular_dispatch_jobs WHERE (status = 'pending' AND next_attempt_at <= ?) OR (status = 'delivering' AND lease_until <= ?) ORDER BY next_attempt_at LIMIT 50`).all(nowIso(), nowIso());
    for (const job of due) {
      if (closed || !db.open) break;
      const claimed = db.prepare(`UPDATE circular_dispatch_jobs SET status='delivering', attempts=attempts+1, lease_until=? WHERE circular_id=? AND ((status='pending' AND next_attempt_at<=?) OR (status='delivering' AND lease_until<=?))`).run(new Date(new Date(now()).getTime() + 120000).toISOString(), job.circular_id, nowIso(), nowIso());
      if (!claimed.changes) continue;
      try {
        const circular = { ...hydrateCircular(db, job.circular_id, { includeStats: true }), ...getCircularExtras(db, job.circular_id) };
        await publish(circular);
        if (options.notificationService) await options.notificationService.notifyCircular(circular);
        if (db.open) db.prepare("UPDATE circular_dispatch_jobs SET status='sent', delivered_at=?, lease_until=NULL, last_error=NULL WHERE circular_id=?").run(nowIso(), job.circular_id);
      } catch (error) {
        if (db.open) db.prepare("UPDATE circular_dispatch_jobs SET status='pending', next_attempt_at=?, lease_until=NULL, last_error=? WHERE circular_id=?").run(new Date(new Date(now()).getTime() + 60000).toISOString(), String(error.message || 'Delivery failed').slice(0, 300), job.circular_id);
      }
    }
  }

  async function runDueSchedules() {
    if (running || closed || !db.open) return;
    running = true;
    try {
      const due = db.prepare("SELECT id FROM circular_work_items WHERE kind='scheduled' AND status='scheduled' AND send_at <= ? ORDER BY send_at, id LIMIT 50").all(nowIso());
      for (const { id } of due) {
        try {
          db.transaction(() => {
            const row = db.prepare("SELECT * FROM circular_work_items WHERE id=? AND status='scheduled' AND send_at<=?").get(id, nowIso());
            if (!row) return;
            const circular = createPublished(row.faculty_id, JSON.parse(row.payload_json));
            db.prepare("UPDATE circular_work_items SET status='sent', circular_id=?, updated_at=?, last_error=NULL WHERE id=?").run(circular.id, nowIso(), id);
          }).immediate();
        } catch (error) {
          db.prepare("UPDATE circular_work_items SET status='failed', updated_at=?, last_error=? WHERE id=? AND status='scheduled'").run(nowIso(), String(error.message || 'The schedule could not be sent.').slice(0, 300), id);
        }
      }
      await flushDispatches();
    } finally { running = false; }
  }

  router.post('/attachments', requireRole('faculty'), express.json({ limit: Math.ceil(maxAttachmentBytes * 4 / 3) + 32768 }), (req, res) => {
    const attachment = validateAttachment(req.body, maxAttachmentBytes);
    const storedSize = Number(db.prepare('SELECT coalesce(sum(size), 0) AS size FROM circular_files WHERE faculty_id=?').get(req.user.id).size);
    assert(storedSize + attachment.content.length <= 200 * 1024 * 1024, 413, 'attachment_quota', 'Your attachment storage limit has been reached.');
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO circular_files (id, faculty_id, name, mime_type, size, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, req.user.id, attachment.name, attachment.mimeType, attachment.content.length, attachment.content, nowIso());
    res.status(201).json({ attachment: { id, name: attachment.name, mimeType: attachment.mimeType, size: attachment.content.length, url: `/api/circular-tools/attachments/${id}` } });
  });
  router.use(express.json({ limit: '64kb' }));

  router.get('/attachments/:id', requireAuth, (req, res) => {
    const row = db.prepare('SELECT * FROM circular_files WHERE id = ?').get(req.params.id);
    const eligible = row && (Number(row.faculty_id) === Number(req.user.id) || db.prepare('SELECT circular_id FROM circular_file_links WHERE file_id = ?').all(row.id).some((link) => userCanReceiveCircular(db, req.user.id, link.circular_id)));
    if (!eligible) throw new ApiError(404, 'attachment_not_found', 'Attachment was not found.');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.attachment(row.name).type(row.mime_type).send(row.content);
  });

  router.delete('/attachments/:id', requireRole('faculty'), (req, res) => {
    const row = db.prepare('SELECT id FROM circular_files WHERE id=? AND faculty_id=?').get(req.params.id, req.user.id);
    if (!row) throw new ApiError(404, 'attachment_not_found', 'Attachment was not found.');
    const linked = db.prepare('SELECT 1 FROM circular_file_links WHERE file_id=?').get(row.id);
    const draftUsesFile = db.prepare("SELECT 1 FROM circular_work_items w, json_each(w.payload_json, '$.attachmentIds') a WHERE a.value=?").get(row.id);
    assert(!linked && !draftUsesFile, 409, 'attachment_in_use', 'Remove this attachment from its saved drafts or templates before deleting it. Published attachments must be retained.');
    db.prepare('DELETE FROM circular_files WHERE id=?').run(row.id);
    res.json({ ok: true });
  });

  router.get('/templates', requireRole('faculty'), (req, res) => {
    const own = db.prepare("SELECT * FROM circular_work_items WHERE faculty_id=? AND kind='template' ORDER BY updated_at DESC LIMIT 100").all(req.user.id).map(workItem);
    res.json({ templates: [...TEMPLATES, ...own], categories: CATEGORIES, priorities: PRIORITIES, maxAttachmentBytes });
  });

  router.get('/items', requireRole('faculty'), (req, res) => {
    const offset = cleanInteger(req.query.offset ?? 0, 'offset', { min: 0, max: 100000 });
    const rows = db.prepare("SELECT * FROM circular_work_items WHERE faculty_id=? AND kind<>'template' ORDER BY updated_at DESC, id DESC LIMIT 51 OFFSET ?").all(req.user.id, offset);
    res.json({ items: rows.slice(0, 50).map(workItem), hasMore: rows.length > 50 });
  });

  function validatedItem(req) {
    const body = requireObject(req.body);
    const kind = body.kind ?? 'draft';
    assert(['draft', 'template', 'scheduled'].includes(kind), 400, 'validation_error', 'Choose draft, template, or scheduled.');
    const payload = normalizePayload(db, req.user.id, body.payload, kind === 'scheduled');
    const name = cleanString(body.name || payload.title || 'Untitled circular', 'name', { min: 1, max: 120 });
    let sendAt = null;
    if (kind === 'scheduled') {
      sendAt = timestamp(body.sendAt, 'sendAt');
      const delta = new Date(sendAt).getTime() - new Date(now()).getTime();
      assert(delta > 0 && delta <= 366 * 86400000, 400, 'validation_error', 'Schedule a time in the future, within the next year.');
    }
    return { kind, payload, name, sendAt, status: kind === 'scheduled' ? 'scheduled' : 'draft' };
  }

  router.post('/items', requireRole('faculty'), (req, res) => {
    const item = validatedItem(req);
    const result = db.prepare('INSERT INTO circular_work_items (faculty_id, kind, name, payload_json, status, send_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(req.user.id, item.kind, item.name, JSON.stringify(item.payload), item.status, item.sendAt, nowIso(), nowIso());
    res.status(201).json({ item: workItem(ownerItem(Number(result.lastInsertRowid), req.user.id)) });
  });

  router.put('/items/:id', requireRole('faculty'), (req, res) => {
    const existing = ownerItem(req.params.id, req.user.id);
    assert(existing.status !== 'sent', 409, 'already_sent', 'A sent circular cannot be changed as a draft.');
    const item = validatedItem(req);
    db.prepare('UPDATE circular_work_items SET kind=?, name=?, payload_json=?, status=?, send_at=?, updated_at=?, last_error=NULL WHERE id=?').run(item.kind, item.name, JSON.stringify(item.payload), item.status, item.sendAt, nowIso(), existing.id);
    res.json({ item: workItem(ownerItem(existing.id, req.user.id)) });
  });

  router.post('/items/:id/cancel', requireRole('faculty'), (req, res) => {
    const item = ownerItem(req.params.id, req.user.id);
    assert(item.status === 'scheduled', 409, 'not_scheduled', 'Only a pending schedule can be cancelled.');
    db.prepare("UPDATE circular_work_items SET status='cancelled', updated_at=? WHERE id=?").run(nowIso(), item.id);
    res.json({ item: workItem(ownerItem(item.id, req.user.id)) });
  });

  router.delete('/items/:id', requireRole('faculty'), (req, res) => {
    const item = ownerItem(req.params.id, req.user.id);
    assert(!['scheduled', 'sent'].includes(item.status), 409, 'item_locked', 'Cancel a pending schedule before deleting it. Sent history is retained.');
    db.prepare('DELETE FROM circular_work_items WHERE id=?').run(item.id);
    res.json({ ok: true });
  });

  router.post('/send', requireRole('faculty'), asyncRoute(async (req, res) => {
    const body = requireObject(req.body);
    const result = db.transaction(() => {
      const item = body.itemId ? ownerItem(body.itemId, req.user.id) : null;
      if (item?.status === 'sent') return { circular: { ...hydrateCircular(db, item.circular_id, { includeStats: true }), ...getCircularExtras(db, item.circular_id) }, repeated: true };
      assert(!item || item.kind !== 'template', 400, 'template_requires_copy', 'Load this template into a new circular before sending.');
      const circular = createPublished(req.user.id, body.payload ?? (item && JSON.parse(item.payload_json)));
      if (item) db.prepare("UPDATE circular_work_items SET status='sent', circular_id=?, updated_at=?, last_error=NULL WHERE id=?").run(circular.id, nowIso(), item.id);
      else db.prepare("INSERT INTO circular_work_items (faculty_id, kind, name, payload_json, status, circular_id, created_at, updated_at) VALUES (?, 'draft', ?, ?, 'sent', ?, ?, ?)").run(req.user.id, circular.summary.slice(0, 120), JSON.stringify(normalizePayload(db, req.user.id, body.payload, true)), circular.id, nowIso(), nowIso());
      return { circular, repeated: false };
    }).immediate();
    await runDueSchedules();
    res.status(result.repeated ? 200 : 201).json(result);
  }));

  router.post('/suggest', requireRole('faculty'), (req, res) => {
    const text = cleanString(requireObject(req.body).text, 'text', { min: 5, max: 5000 });
    const groups = db.prepare('SELECT * FROM groups ORDER BY id').all().filter((group) => !group.archived && !group.archived_at).map(serializeGroup);
    const analysis = analyzeText(text, groups);
    const rules = [['emergency', /evacuat|safety alert|emergency|campus closure/i], ['examination', /exam|midterm|semester test/i], ['scholarship', /scholarship|financial aid/i], ['placement', /placement|recruit|resume|interview/i], ['sports', /sports|match|athlet|tournament/i], ['club', /club|competition|hackathon/i], ['event', /workshop|seminar|conference|event/i], ['academic', /class|lecture|assignment|laboratory/i]];
    const category = rules.find(([, pattern]) => pattern.test(text))?.[0] || 'general';
    const priority = category === 'emergency' ? 'emergency' : analysis.urgency === 'urgent' ? 'urgent' : /important|deadline|mandatory/i.test(text) ? 'important' : 'normal';
    res.json({ suggestions: { ...analysis, title: analysis.summary.slice(0, 240), category, priority, deadline: /deadline|submit|register|apply.*before/i.test(text) ? analysis.detectedDate : null, requiresAcknowledgment: ['urgent', 'emergency'].includes(priority) } });
  });

  router.get('/circulars/:id/details', requireAuth, (req, res) => {
    const circular = accessibleCircular(req.params.id, req.user);
    res.json({ details: getCircularExtras(db, circular.id) });
  });

  router.patch('/circulars/:id/details', requireRole('faculty'), (req, res) => {
    const circular = accessibleCircular(req.params.id, req.user, true);
    const previous = getCircularExtras(db, circular.id);
    const metadata = normalizeMetadata({ title: circular.summary, priority: circular.urgency === 'urgent' ? 'urgent' : 'normal', ...previous, ...requireObject(req.body) });
    assert(!metadata.eventTime || circular.detected_date, 400, 'validation_error', 'An event time requires a circular with an event date.');
    db.transaction(() => {
      db.prepare('INSERT INTO circular_revision_log (circular_id, faculty_id, previous_json, created_at) VALUES (?, ?, ?, ?)').run(circular.id, req.user.id, JSON.stringify(previous), nowIso());
      storeCircularExtras(db, circular.id, metadata, [], nowIso());
      db.prepare('UPDATE circulars SET summary=?, urgency=? WHERE id=?').run(metadata.title || circular.summary, ['urgent', 'emergency'].includes(metadata.priority) ? 'urgent' : 'normal', circular.id);
    })();
    res.json({ details: getCircularExtras(db, circular.id) });
  });

  router.get('/circulars/:id/history', requireRole('faculty'), (req, res) => {
    const circular = accessibleCircular(req.params.id, req.user, true);
    const revisions = db.prepare('SELECT id, previous_json, created_at FROM circular_revision_log WHERE circular_id=? ORDER BY id DESC LIMIT 100').all(circular.id).map((row) => ({ id: row.id, previous: JSON.parse(row.previous_json), createdAt: row.created_at }));
    res.json({ revisions });
  });

  router.post('/circulars/:id/attendance-token', requireRole('faculty'), asyncRoute(async (req, res) => {
    const circular = accessibleCircular(req.params.id, req.user, true);
    assert(circular.detected_date, 400, 'event_date_required', 'Add an event date to this circular before creating check-in.');
    const body = requireObject(req.body || {});
    const ttlMinutes = cleanInteger(body.ttlMinutes ?? 15, 'ttlMinutes', { min: 1, max: 120 });
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(new Date(now()).getTime() + ttlMinutes * 60000).toISOString();
    db.transaction(() => {
      db.prepare('UPDATE circular_attendance_tokens SET revoked_at=? WHERE circular_id=? AND revoked_at IS NULL').run(nowIso(), circular.id);
      db.prepare('INSERT INTO circular_attendance_tokens (circular_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)').run(circular.id, crypto.createHash('sha256').update(token).digest('hex'), expiresAt, nowIso());
    })();
    const checkInPath = `/student/check-in?token=${encodeURIComponent(token)}`;
    const configuredOrigin = options.publicOrigin || null;
    const qrUrl = configuredOrigin ? `${configuredOrigin.replace(/\/$/, '')}${checkInPath}` : checkInPath;
    const qrDataUrl = await require('qrcode').toDataURL(qrUrl, { width: 280, margin: 2, errorCorrectionLevel: 'M' });
    res.json({ token, expiresAt, checkInPath, qrDataUrl });
  }));

  router.delete('/circulars/:id/attendance-token', requireRole('faculty'), (req, res) => {
    const circular = accessibleCircular(req.params.id, req.user, true);
    db.prepare('UPDATE circular_attendance_tokens SET revoked_at=? WHERE circular_id=? AND revoked_at IS NULL').run(nowIso(), circular.id);
    res.json({ ok: true });
  });

  router.get('/circulars/:id/attendance', requireRole('faculty'), (req, res) => {
    const circular = accessibleCircular(req.params.id, req.user, true);
    const attendance = db.prepare('SELECT u.id, u.name, u.email, a.checked_in_at FROM circular_attendance a JOIN users u ON u.id=a.student_id WHERE a.circular_id=? ORDER BY a.checked_in_at, u.name').all(circular.id).map((row) => ({ studentId: row.id, name: row.name, email: row.email, checkedInAt: row.checked_in_at }));
    res.json({ attendance, total: attendance.length });
  });

  function validAttendanceToken(value, user) {
    const token = cleanString(value, 'token', { min: 43, max: 43 });
    const row = db.prepare('SELECT * FROM circular_attendance_tokens WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').get(crypto.createHash('sha256').update(token).digest('hex'), nowIso());
    if (!row || !userCanReceiveCircular(db, user.id, row.circular_id)) throw new ApiError(404, 'check_in_unavailable', 'This check-in link has expired or is not available for your groups.');
    return row;
  }

  router.post('/attendance/preview', requireRole('student'), (req, res) => {
    const token = validAttendanceToken(requireObject(req.body).token, req.user);
    const circular = hydrateCircular(db, token.circular_id, { recipientId: req.user.id });
    const existing = db.prepare('SELECT checked_in_at FROM circular_attendance WHERE circular_id=? AND student_id=?').get(token.circular_id, req.user.id);
    res.json({ circular, expiresAt: token.expires_at, checkedInAt: existing?.checked_in_at || null });
  });

  router.post('/attendance/check-in', requireRole('student'), (req, res) => {
    const token = validAttendanceToken(requireObject(req.body).token, req.user);
    const result = db.prepare('INSERT OR IGNORE INTO circular_attendance (circular_id, student_id, checked_in_at) VALUES (?, ?, ?)').run(token.circular_id, req.user.id, nowIso());
    const row = db.prepare('SELECT checked_in_at FROM circular_attendance WHERE circular_id=? AND student_id=?').get(token.circular_id, req.user.id);
    res.json({ circularId: token.circular_id, checkedInAt: row.checked_in_at, alreadyCheckedIn: !result.changes });
  });

  return {
    router,
    runDueSchedules,
    startScheduler(intervalMs = 15000) {
      if (timer || closed) return;
      timer = setInterval(() => { runDueSchedules().catch((error) => options.onError?.(error)); }, Math.max(1000, intervalMs));
      timer.unref?.();
      runDueSchedules().catch((error) => options.onError?.(error));
    },
    close() { closed = true; clearInterval(timer); timer = null; },
  };
}

module.exports = { createCircularTools, getCircularExtras, normalizeMetadata, storeCircularExtras, CATEGORIES, PRIORITIES, MAX_ATTACHMENT_BYTES };
