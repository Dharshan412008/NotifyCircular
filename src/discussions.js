'use strict';
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { requireAuth } = require('./auth');
const { assert } = require('./errors');
const { cleanInteger, cleanString, requireObject } = require('./validation');
const { utcNow } = require('./db');

function discussionsRouter(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS discussion_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      reply_to INTEGER REFERENCES discussion_messages(id) ON DELETE SET NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS discussion_group_messages ON discussion_messages(group_id, id);
    CREATE TABLE IF NOT EXISTS discussion_reactions (
      message_id INTEGER NOT NULL REFERENCES discussion_messages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      PRIMARY KEY(message_id, user_id, emoji)
    );
    CREATE TABLE IF NOT EXISTS discussion_reads (
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_message_id INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(group_id, user_id)
    );
  `);
  const router = express.Router();
  router.use(requireAuth, express.json({ limit: '16kb' }));
  const writeLimit = rateLimit({ windowMs: 60_000, limit: 60, keyGenerator: (req) => String(req.user.id), standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { message: 'Please slow down and try again in a minute.' } } });
  const staff = (user) => ['faculty', 'admin'].includes(user.role);
  const allowed = (user, id) => db.prepare(`SELECT g.id,g.name,g.description FROM groups g WHERE g.id=? AND g.kind!='role' AND (? OR EXISTS(SELECT 1 FROM student_group_memberships WHERE group_id=g.id AND student_id=?))`).get(id, Number(staff(user)), user.id);
  router.get('/', (req, res) => {
    const channels = db.prepare(`SELECT g.id,g.name,g.description,
      COALESCE((SELECT MAX(id) FROM discussion_messages WHERE group_id=g.id),0) AS lastMessageId,
      (SELECT COUNT(*) FROM discussion_messages m WHERE m.group_id=g.id AND m.deleted=0 AND m.user_id!=? AND m.id>COALESCE((SELECT last_message_id FROM discussion_reads WHERE group_id=g.id AND user_id=?),0)) AS unread
      FROM groups g WHERE g.kind!='role' AND (? OR EXISTS(SELECT 1 FROM student_group_memberships WHERE group_id=g.id AND student_id=?)) ORDER BY g.name COLLATE NOCASE`).all(req.user.id, req.user.id, Number(staff(req.user)), req.user.id);
    res.json({ channels });
  });
  router.use('/:groupId', (req, res, next) => {
    req.channelId = cleanInteger(req.params.groupId, 'group', { min: 1 });
    assert(allowed(req.user, req.channelId), 404, 'not_found', 'This discussion is not available to you.');
    next();
  });
  function message(req) {
    const id = cleanInteger(req.params.messageId, 'message', { min: 1 });
    const row = db.prepare('SELECT * FROM discussion_messages WHERE id=? AND group_id=? AND deleted=0').get(id, req.channelId);
    assert(row, 404, 'not_found', 'This message is no longer available.');
    return row;
  }
  router.get('/:groupId/messages', (req, res) => {
    const before = req.query.before === undefined ? Number.MAX_SAFE_INTEGER : cleanInteger(req.query.before, 'before', { min: 1 });
    const q = cleanString(req.query.q || '', 'search', { max: 100 });
    const pinned = req.query.pinned === 'true';
    const rows = db.prepare(`SELECT m.id,m.body,m.created_at AS createdAt,m.user_id AS authorId,u.name AS authorName,u.role AS authorRole,m.pinned,m.deleted,
      r.id AS replyId, CASE WHEN r.deleted=1 THEN 'Message removed' ELSE r.body END AS replyBody, ru.name AS replyAuthor
      FROM discussion_messages m JOIN users u ON u.id=m.user_id
      LEFT JOIN discussion_messages r ON r.id=m.reply_to LEFT JOIN users ru ON ru.id=r.user_id
      WHERE m.group_id=? AND m.id<? AND (?='' OR (m.deleted=0 AND (instr(lower(m.body),lower(?))>0 OR instr(lower(u.name),lower(?))>0))) AND (?=0 OR (m.pinned=1 AND m.deleted=0))
      ORDER BY m.id DESC LIMIT 41`).all(req.channelId, before, q, q, q, Number(pinned));
    const messages = rows.slice(0, 40).map((row) => ({ ...row, body: row.deleted ? 'Message removed' : row.body, reactions: row.deleted ? [] : db.prepare(`SELECT emoji,COUNT(*) AS count,MAX(user_id=?) AS mine FROM discussion_reactions WHERE message_id=? GROUP BY emoji ORDER BY emoji`).all(req.user.id, row.id) }));
    res.json({ messages, nextCursor: rows.length > 40 ? rows[39].id : null });
  });
  router.post('/:groupId/messages', writeLimit, (req, res) => {
    const body = requireObject(req.body);
    const text = cleanString(body.text, 'message', { min: 1, max: 2000 });
    const replyId = body.replyTo == null ? null : cleanInteger(body.replyTo, 'replyTo', { min: 1 });
    if (replyId) assert(db.prepare('SELECT id FROM discussion_messages WHERE id=? AND group_id=? AND deleted=0').get(replyId, req.channelId), 400, 'invalid_reply', 'Reply to an available message in this discussion.');
    const result = db.prepare('INSERT INTO discussion_messages(group_id,user_id,body,reply_to,created_at) VALUES(?,?,?,?,?)').run(req.channelId, req.user.id, text, replyId, utcNow());
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });
  router.put('/:groupId/read', (req, res) => {
    const id = cleanInteger(requireObject(req.body).messageId, 'messageId', { min: 1 });
    assert(db.prepare('SELECT id FROM discussion_messages WHERE id=? AND group_id=?').get(id, req.channelId), 400, 'invalid_message', 'Choose a message from this discussion.');
    db.prepare('INSERT INTO discussion_reads(group_id,user_id,last_message_id) VALUES(?,?,?) ON CONFLICT(group_id,user_id) DO UPDATE SET last_message_id=MAX(last_message_id,excluded.last_message_id)').run(req.channelId, req.user.id, id);
    res.json({ ok: true });
  });
  router.put('/:groupId/messages/:messageId/reactions', writeLimit, (req, res) => {
    const row = message(req), body = requireObject(req.body);
    assert(['👍', '🎉', '❤️', '❓'].includes(body.emoji) && typeof body.active === 'boolean', 400, 'invalid_reaction', 'Choose a supported reaction.');
    if (body.active) db.prepare('INSERT OR IGNORE INTO discussion_reactions(message_id,user_id,emoji) VALUES(?,?,?)').run(row.id, req.user.id, body.emoji);
    else db.prepare('DELETE FROM discussion_reactions WHERE message_id=? AND user_id=? AND emoji=?').run(row.id, req.user.id, body.emoji);
    res.json({ ok: true });
  });
  router.put('/:groupId/messages/:messageId/pin', (req, res) => {
    assert(staff(req.user), 403, 'forbidden', 'Only faculty can manage pinned messages.');
    const row = message(req), body = requireObject(req.body);
    assert(typeof body.pinned === 'boolean', 400, 'invalid_pin', 'Choose whether to pin this message.');
    if (body.pinned && !row.pinned) assert(db.prepare('SELECT COUNT(*) AS n FROM discussion_messages WHERE group_id=? AND pinned=1 AND deleted=0').get(req.channelId).n < 5, 400, 'pin_limit', 'Unpin a message first. Each discussion can have five pins.');
    db.prepare('UPDATE discussion_messages SET pinned=? WHERE id=?').run(Number(body.pinned), row.id);
    res.json({ ok: true });
  });
  router.delete('/:groupId/messages/:messageId', (req, res) => {
    const row = message(req);
    assert(row.user_id === req.user.id || staff(req.user), 403, 'forbidden', 'You can only remove your own messages.');
    db.transaction(() => {
      db.prepare("UPDATE discussion_messages SET body='',deleted=1,pinned=0 WHERE id=?").run(row.id);
      db.prepare('DELETE FROM discussion_reactions WHERE message_id=?').run(row.id);
    })();
    res.json({ ok: true });
  });
  return router;
}
module.exports = { discussionsRouter };
