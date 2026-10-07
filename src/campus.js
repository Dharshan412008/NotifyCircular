'use strict';

const express = require('express');
const { requireAuth } = require('./auth');
const { assert } = require('./errors');
const { cleanInteger, cleanString, requireObject } = require('./validation');
const { utcNow } = require('./db');

const TOPICS = ['general', 'achievement', 'event', 'opportunity', 'question'];
function cleanTopic(value) {
  assert(TOPICS.includes(value), 400, 'validation_error', 'Choose a valid campus topic.');
  return value;
}

function campusRouter(db) {
  const router = express.Router();
  router.use(requireAuth);
  router.use(express.json({ limit: '3mb' }));
  router.use((req, res, next) => {
    res.on('finish', () => { if (res.statusCode < 400 && !['GET', 'HEAD'].includes(req.method)) req.app.locals.publishCampus?.(); });
    next();
  });
  function notifyOwner(req, post, kind, message, key) {
    if (post.user_id === req.user.id) return;
    const owner = db.prepare('SELECT role,disabled FROM users WHERE id=?').get(post.user_id);
    if (!owner || owner.disabled) return;
    require('./platform').addNotification(db, { userId: post.user_id, kind, title: kind === 'reaction' ? `${req.user.name} liked your post` : `${req.user.name} commented on your post`, message, postId: post.id, href: `/${owner.role}/campus?post=${post.id}`, key });
    req.app.locals.publishNotification?.(post.user_id);
  }
  const postId = (req) => cleanInteger(req.params.id, 'id', { min: 1 });
  function existing(req) {
    const post = db.prepare('SELECT id, user_id, topic FROM campus_posts WHERE id = ?').get(postId(req));
    assert(post, 404, 'post_not_found', 'This post is no longer available.');
    return post;
  }
  router.get('/', (req, res) => {
    const before = req.query.before === undefined ? Number.MAX_SAFE_INTEGER : cleanInteger(req.query.before, 'before', { min: 1 });
    const search = cleanString(req.query.q ?? '', 'search', { max: 100 }).toLowerCase();
    const view = req.query.view ?? 'all';
    assert(['all', 'saved', 'mine'].includes(view), 400, 'validation_error', 'Choose a valid feed view.');
    const topic = req.query.topic === undefined || req.query.topic === 'all' ? 'all' : cleanTopic(req.query.topic);
    const exactId = req.query.post === undefined ? 0 : cleanInteger(req.query.post, 'post', { min: 1 });
    const posts = db.prepare(`SELECT p.id, p.caption, p.topic, p.created_at AS createdAt,
      p.user_id AS authorId, u.name AS authorName, u.role AS authorRole,
      p.image_type IS NOT NULL AS hasImage,
      (SELECT COUNT(*) FROM campus_likes WHERE post_id = p.id) AS likeCount,
      (SELECT COUNT(*) FROM campus_comments WHERE post_id = p.id) AS commentCount,
      EXISTS(SELECT 1 FROM campus_likes WHERE post_id = p.id AND user_id = ?) AS liked,
      EXISTS(SELECT 1 FROM campus_saved_posts WHERE post_id = p.id AND user_id = ?) AS saved
      FROM campus_posts p JOIN users u ON u.id = p.user_id
      WHERE p.id < ? AND (? = '' OR instr(lower(p.caption), ?) > 0 OR instr(lower(u.name), ?) > 0)
      AND (? != 'mine' OR p.user_id = ?)
      AND (? != 'saved' OR EXISTS(SELECT 1 FROM campus_saved_posts WHERE post_id = p.id AND user_id = ?))
      AND (? = 'all' OR p.topic = ?)
      AND (? = 0 OR p.id = ?)
      ORDER BY p.id DESC LIMIT 21`).all(req.user.id, req.user.id, before, search, search, search, view, req.user.id, view, req.user.id, topic, topic, exactId, exactId);
    const hasMore = posts.length > 20;
    res.json({ posts: posts.slice(0, 20), nextCursor: hasMore ? posts[19].id : null });
  });
  router.post('/', (req, res) => {
    const body = requireObject(req.body);
    const caption = cleanString(body.caption, 'caption', { min: 1, max: 2000 });
    const topic = cleanTopic(body.topic === undefined ? 'general' : body.topic);
    let image = null;
    let imageType = null;
    if (body.image) {
      assert(typeof body.image === 'string', 400, 'invalid_image', 'Choose a JPEG, PNG, or WebP photo.');
      const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.image);
      assert(match, 400, 'invalid_image', 'Choose a JPEG, PNG, or WebP photo.');
      image = Buffer.from(match[2], 'base64');
      const valid = match[1] === 'jpeg' ? image.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
        : match[1] === 'png' ? image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP';
      assert(valid && image.length <= 2 * 1024 * 1024, 400, 'invalid_image', 'Choose a valid photo smaller than 2 MB.');
      imageType = `image/${match[1]}`;
    }
    const result = db.prepare('INSERT INTO campus_posts(user_id, caption, topic, image, image_type, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(req.user.id, caption, topic, image, imageType, utcNow());
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });
  router.get('/:id/image', (req, res) => {
    const row = db.prepare('SELECT image, image_type FROM campus_posts WHERE id = ?').get(postId(req));
    assert(row?.image, 404, 'image_not_found', 'Photo unavailable.');
    res.type(row.image_type).send(row.image);
  });
  router.delete('/:id', (req, res) => {
    const post = existing(req);
    assert(post.user_id === req.user.id, 403, 'forbidden', 'You can only delete your own posts.');
    db.prepare('DELETE FROM campus_posts WHERE id = ?').run(post.id);
    res.json({ ok: true });
  });
  router.patch('/:id', (req, res) => {
    const post = existing(req);
    assert(post.user_id === req.user.id, 403, 'forbidden', 'You can only edit your own posts.');
    const body = requireObject(req.body);
    const caption = cleanString(body.caption, 'caption', { min: 1, max: 2000 });
    const topic = body.topic === undefined ? post.topic : cleanTopic(body.topic);
    db.prepare('UPDATE campus_posts SET caption = ?, topic = ? WHERE id = ?').run(caption, topic, post.id);
    res.json({ ok: true });
  });
  router.put('/:id/save', (req, res) => {
    const post = existing(req);
    db.prepare('INSERT OR IGNORE INTO campus_saved_posts(post_id, user_id) VALUES (?, ?)').run(post.id, req.user.id);
    res.json({ ok: true });
  });
  router.delete('/:id/save', (req, res) => {
    const post = existing(req);
    db.prepare('DELETE FROM campus_saved_posts WHERE post_id = ? AND user_id = ?').run(post.id, req.user.id);
    res.json({ ok: true });
  });
  router.put('/:id/like', (req, res) => {
    const post = existing(req);
    db.prepare('INSERT OR IGNORE INTO campus_likes(post_id, user_id) VALUES (?, ?)').run(post.id, req.user.id);
    notifyOwner(req, post, 'reaction', 'Your campus moment is getting noticed.', `like:${post.id}:${req.user.id}`);
    res.json({ ok: true });
  });
  router.delete('/:id/like', (req, res) => {
    const post = existing(req);
    db.prepare('DELETE FROM campus_likes WHERE post_id = ? AND user_id = ?').run(post.id, req.user.id);
    res.json({ ok: true });
  });
  router.get('/:id/comments', (req, res) => {
    const post = existing(req);
    const before = req.query.before === undefined ? Number.MAX_SAFE_INTEGER : cleanInteger(req.query.before, 'before', { min: 1 });
    const comments = db.prepare(`SELECT c.id, c.user_id AS authorId, c.text, c.created_at AS createdAt, u.name AS authorName
      FROM campus_comments c JOIN users u ON u.id = c.user_id
      WHERE c.post_id = ? AND c.id < ? ORDER BY c.id DESC LIMIT 21`).all(post.id, before);
    res.json({ comments: comments.slice(0, 20), nextCursor: comments.length > 20 ? comments[19].id : null });
  });
  router.post('/:id/comments', (req, res) => {
    const post = existing(req);
    const text = cleanString(requireObject(req.body).text, 'comment', { min: 1, max: 500 });
    const result = db.prepare('INSERT INTO campus_comments(post_id, user_id, text, created_at) VALUES (?, ?, ?, ?)').run(post.id, req.user.id, text, utcNow());
    notifyOwner(req, post, 'comment', text, `comment:${result.lastInsertRowid}`);
    res.status(201).json({ ok: true });
  });
  router.delete('/:id/comments/:commentId', (req, res) => {
    const post = existing(req);
    const id = cleanInteger(req.params.commentId, 'commentId', { min: 1 });
    const row = db.prepare('SELECT user_id FROM campus_comments WHERE id=? AND post_id=?').get(id, post.id);
    assert(row, 404, 'not_found', 'Comment unavailable.');
    assert(row.user_id === req.user.id, 403, 'forbidden', 'You can only delete your own comments.');
    db.prepare('DELETE FROM campus_comments WHERE id=?').run(id);
    res.json({ ok: true });
  });
  return router;
}

module.exports = { campusRouter };
