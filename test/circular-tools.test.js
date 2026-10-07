'use strict';

const assert = require('node:assert/strict');
const { beforeEach, afterEach, describe, it } = require('node:test');
const express = require('express');
const request = require('supertest');
const { openDatabase } = require('../src/db');
const { createCircularTools } = require('../src/circular-tools');
const { errorHandler } = require('../src/errors');

describe('Circular studio drafts, schedules, attachments, and attendance', () => {
  let db;
  let app;
  let service;
  let currentTime;
  let published;
  let faculty;
  let otherFaculty;
  let asha;
  let ravi;
  let firstYear;
  let wholeCollege;
  const file = { name: 'details.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF-1.4\nCampus workshop information\n%%EOF').toString('base64') };
  const endpoint = '/api/circular-tools';
  const payload = (extra = {}) => ({ title: 'Robotics workshop', text: 'Join the robotics workshop in the auditorium. Bring your college ID.', category: 'event', priority: 'important', targetGroupIds: [firstYear.id], detectedDate: '2027-01-15', eventTime: '15:00', location: 'Auditorium', deadline: '2027-01-14', pinnedUntil: '2027-01-15', attachmentIds: [], requiresAcknowledgment: true, ...extra });
  const as = (user) => {
    const client = request(app);
    return Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map((method) => [method, (path) => client[method](endpoint + path).set('x-test-user', String(user.id))]));
  };

  beforeEach(() => {
    db = openDatabase({ filename: ':memory:', bcryptRounds: 4 });
    const byEmail = (email) => db.prepare('SELECT * FROM users WHERE email=?').get(email);
    faculty = byEmail('faculty@demo.edu');
    otherFaculty = byEmail('arjun@demo.edu');
    asha = byEmail('asha@demo.edu');
    ravi = byEmail('ravi@demo.edu');
    firstYear = db.prepare("SELECT * FROM groups WHERE slug='first-year'").get();
    wholeCollege = db.prepare("SELECT * FROM groups WHERE slug='whole-college'").get();
    currentTime = new Date('2027-01-01T08:00:00.000Z');
    published = [];
    service = createCircularTools({ db, now: () => currentTime, publicOrigin: 'https://campus.example.edu', publishCircular: (circular) => published.push(circular.id) });
    app = express();
    app.set('env', 'test');
    // Test-only identity injection isolates the router while retaining its role gates.
    app.use((req, _res, next) => { req.user = req.headers['x-test-user'] ? db.prepare('SELECT * FROM users WHERE id=?').get(req.headers['x-test-user']) : null; next(); });
    app.use(endpoint, service.router);
    app.use(errorHandler);
  });

  afterEach(() => { service.close(); db.close(); });

  it('keeps private drafts and templates scoped to their faculty owner', async () => {
    await request(app).get(`${endpoint}/templates`).expect(401);
    await as(asha).get('/templates').expect(403);
    const library = (await as(faculty).get('/templates').expect(200)).body;
    assert.equal(library.templates.length, 7);
    assert(library.templates.every((template) => template.builtin));
    const draft = (await as(faculty).post('/items').send({ kind: 'draft', payload: { text: 'A draft' } }).expect(201)).body.item;
    assert.equal(draft.payload.category, 'general');
    assert.deepEqual(draft.payload.targetGroupIds, []);
    await as(otherFaculty).put(`/items/${draft.id}`).send({ payload: payload() }).expect(404);
    assert.equal((await as(otherFaculty).get('/items').expect(200)).body.items.length, 0);
    await as(faculty).put(`/items/${draft.id}`).send({ name: 'My workshop', kind: 'draft', payload: payload() }).expect(200);
    const template = (await as(faculty).post('/items').send({ name: 'My reusable workshop', kind: 'template', payload: payload() }).expect(201)).body.item;
    assert.equal((await as(faculty).get('/templates').expect(200)).body.templates.length, 8);
    await as(faculty).post('/send').send({ itemId: template.id }).expect(400);
    await as(faculty).delete(`/items/${draft.id}`).expect(200);
    assert.equal((await as(faculty).get('/items').expect(200)).body.items.length, 0);
  });

  it('validates file content and author ownership before allowing audience-scoped downloads', async () => {
    await as(asha).post('/attachments').send(file).expect(403);
    await as(faculty).post('/attachments').send({ ...file, name: 'details.docx' }).expect(400);
    await as(faculty).post('/attachments').send({ ...file, data: Buffer.from('<script>alert(1)</script>').toString('base64') }).expect(400);
    const attachment = (await as(faculty).post('/attachments').send(file).expect(201)).body.attachment;
    await as(asha).get(`/attachments/${attachment.id}`).expect(404);
    await as(otherFaculty).post('/items').send({ payload: payload({ attachmentIds: [attachment.id] }) }).expect(400);
    const circular = (await as(faculty).post('/send').send({ payload: payload({ attachmentIds: [attachment.id] }) }).expect(201)).body.circular;
    assert.equal(circular.attachments[0].name, 'details.pdf');
    const download = await as(asha).get(`/attachments/${attachment.id}`).expect(200);
    assert.match(download.headers['content-disposition'], /attachment/);
    assert.equal(download.headers['x-content-type-options'], 'nosniff');
    assert.equal(download.headers['cache-control'], 'private, no-store');
    await as(ravi).get(`/attachments/${attachment.id}`).expect(404);
    await as(faculty).delete(`/attachments/${attachment.id}`).expect(409);
  });

  it('retains files used by saved work and allows cleanup after removing references', async () => {
    const attachment = (await as(faculty).post('/attachments').send(file).expect(201)).body.attachment;
    const item = (await as(faculty).post('/items').send({ payload: payload({ attachmentIds: [attachment.id] }) }).expect(201)).body.item;
    await as(faculty).delete(`/attachments/${attachment.id}`).expect(409);
    await as(faculty).put(`/items/${item.id}`).send({ payload: payload() }).expect(200);
    await as(faculty).delete(`/attachments/${attachment.id}`).expect(200);
    await as(faculty).get(`/attachments/${attachment.id}`).expect(404);
  });

  it('sends a saved draft exactly once across retries and records recipient metadata', async () => {
    const draft = (await as(faculty).post('/items').send({ payload: payload({ targetGroupIds: [firstYear.id, wholeCollege.id] }) }).expect(201)).body.item;
    const countBefore = db.prepare('SELECT count(*) AS n FROM circulars').get().n;
    const sent = (await as(faculty).post('/send').send({ itemId: draft.id }).expect(201)).body;
    const repeated = (await as(faculty).post('/send').send({ itemId: draft.id }).expect(200)).body;
    assert.equal(repeated.repeated, true);
    assert.equal(sent.circular.id, repeated.circular.id);
    assert.equal(db.prepare('SELECT count(*) AS n FROM circulars').get().n, countBefore + 1);
    assert.equal(sent.circular.priority, 'important');
    assert.equal(sent.circular.location, 'Auditorium');
    assert.equal(sent.circular.stats.audience, 2);
    assert.deepEqual(published, [sent.circular.id]);
    assert.equal(db.prepare('SELECT status FROM circular_dispatch_jobs WHERE circular_id=?').get(sent.circular.id).status, 'sent');
    await as(faculty).put(`/items/${draft.id}`).send({ payload: payload() }).expect(409);
    await as(faculty).delete(`/items/${draft.id}`).expect(409);
  });

  it('delivers due schedules after restarting the service without duplicating sent circulars', async () => {
    const scheduled = (await as(faculty).post('/items').send({ kind: 'scheduled', payload: payload(), sendAt: '2027-01-01T08:15:00.000Z' }).expect(201)).body.item;
    await as(faculty).delete(`/items/${scheduled.id}`).expect(409);
    await service.runDueSchedules();
    assert.equal(published.length, 0);
    service.close();
    currentTime = new Date('2027-01-01T08:16:00.000Z');
    service = createCircularTools({ db, now: () => currentTime, publishCircular: (circular) => published.push(circular.id) });
    await service.runDueSchedules();
    const row = db.prepare('SELECT * FROM circular_work_items WHERE id=?').get(scheduled.id);
    assert.equal(row.status, 'sent');
    assert.equal(row.circular_id, published[0]);
    await service.runDueSchedules();
    assert.equal(published.length, 1);
  });

  it('cancels pending delivery and rejects invalid complete circulars before persistence', async () => {
    const beforeCount = db.prepare('SELECT count(*) AS n FROM circular_work_items').get().n;
    await as(faculty).post('/items').send({ kind: 'scheduled', payload: payload(), sendAt: '2026-01-01T08:15:00.000Z' }).expect(400);
    await as(faculty).post('/items').send({ kind: 'scheduled', payload: payload({ targetGroupIds: [] }), sendAt: '2027-01-01T08:15:00.000Z' }).expect(400);
    await as(faculty).post('/items').send({ payload: payload({ detectedDate: null, eventTime: '15:00' }) }).expect(400);
    await as(faculty).post('/send').send({ payload: payload({ targetGroupIds: [999999] }) }).expect(400);
    assert.equal(db.prepare('SELECT count(*) AS n FROM circular_work_items').get().n, beforeCount);
    const item = (await as(faculty).post('/items').send({ kind: 'scheduled', payload: payload(), sendAt: '2027-01-01T08:15:00.000Z' }).expect(201)).body.item;
    await as(otherFaculty).post(`/items/${item.id}/cancel`).expect(404);
    await as(faculty).post(`/items/${item.id}/cancel`).expect(200);
    currentTime = new Date('2027-01-01T08:16:00.000Z');
    await service.runDueSchedules();
    assert.equal(published.length, 0);
    await as(faculty).delete(`/items/${item.id}`).expect(200);
  });

  it('retries notification failures from persisted dispatch jobs', async () => {
    service.close();
    let attempts = 0;
    service = createCircularTools({ db, now: () => currentTime, notificationService: { notifyCircular() { attempts += 1; if (attempts === 1) throw new Error('Temporary transport failure'); } } });
    const appWithRetry = express();
    appWithRetry.use((req, _res, next) => { req.user = faculty; next(); });
    appWithRetry.use(endpoint, service.router);
    appWithRetry.use(errorHandler);
    const circular = (await request(appWithRetry).post(`${endpoint}/send`).send({ payload: payload() }).expect(201)).body.circular;
    assert.equal(db.prepare('SELECT status FROM circular_dispatch_jobs WHERE circular_id=?').get(circular.id).status, 'pending');
    currentTime = new Date('2027-01-01T08:02:00.000Z');
    await service.runDueSchedules();
    assert.equal(attempts, 2);
    assert.equal(db.prepare('SELECT status FROM circular_dispatch_jobs WHERE circular_id=?').get(circular.id).status, 'sent');
  });

  it('keeps pinned metadata revisions and limits edits to the sending faculty', async () => {
    const circular = (await as(faculty).post('/send').send({ payload: payload() }).expect(201)).body.circular;
    await as(ravi).get(`/circulars/${circular.id}/details`).expect(404);
    await as(asha).get(`/circulars/${circular.id}/details`).expect(200);
    await as(otherFaculty).patch(`/circulars/${circular.id}/details`).send({ title: 'Tampered' }).expect(404);
    await as(asha).patch(`/circulars/${circular.id}/details`).send({ title: 'Tampered' }).expect(403);
    const changed = (await as(faculty).patch(`/circulars/${circular.id}/details`).send({ title: 'Workshop room changed', location: 'Lab 2', priority: 'urgent', pinnedUntil: '2027-01-16' }).expect(200)).body.details;
    assert.equal(changed.location, 'Lab 2');
    assert.equal(changed.pinnedUntil, '2027-01-16');
    const history = (await as(faculty).get(`/circulars/${circular.id}/history`).expect(200)).body.revisions;
    assert.equal(history.length, 1);
    assert.equal(history[0].previous.title, 'Robotics workshop');
    assert.equal(db.prepare('SELECT urgency FROM circulars WHERE id=?').get(circular.id).urgency, 'urgent');
  });

  it('checks in eligible students once and rejects expired, replaced, revoked, and wrong-audience tokens', async () => {
    const circular = (await as(faculty).post('/send').send({ payload: payload() }).expect(201)).body.circular;
    await as(otherFaculty).post(`/circulars/${circular.id}/attendance-token`).send({}).expect(404);
    const token = (await as(faculty).post(`/circulars/${circular.id}/attendance-token`).send({ ttlMinutes: 15 }).expect(200)).body;
    assert.match(token.qrDataUrl, /^data:image\/png;base64,/);
    assert.match(token.checkInPath, /^\/student\/check-in\?token=/);
    assert.equal(token.token.length, 43);
    assert.notEqual(db.prepare('SELECT token_hash FROM circular_attendance_tokens WHERE circular_id=?').get(circular.id).token_hash, token.token);
    await as(ravi).post('/attendance/preview').send({ token: token.token }).expect(404);
    await as(faculty).post('/attendance/check-in').send({ token: token.token }).expect(403);
    const preview = (await as(asha).post('/attendance/preview').send({ token: token.token }).expect(200)).body;
    assert.equal(preview.circular.id, circular.id);
    assert.equal(preview.checkedInAt, null);
    const checked = (await as(asha).post('/attendance/check-in').send({ token: token.token }).expect(200)).body;
    assert.equal(checked.alreadyCheckedIn, false);
    assert.equal((await as(asha).post('/attendance/check-in').send({ token: token.token }).expect(200)).body.alreadyCheckedIn, true);
    const attendees = (await as(faculty).get(`/circulars/${circular.id}/attendance`).expect(200)).body;
    assert.equal(attendees.total, 1);
    assert.equal(attendees.attendance[0].studentId, asha.id);
    const next = (await as(faculty).post(`/circulars/${circular.id}/attendance-token`).send({ ttlMinutes: 1 }).expect(200)).body;
    await as(asha).post('/attendance/preview').send({ token: token.token }).expect(404);
    currentTime = new Date('2027-01-01T08:02:00.000Z');
    await as(asha).post('/attendance/check-in').send({ token: next.token }).expect(404);
    const last = (await as(faculty).post(`/circulars/${circular.id}/attendance-token`).send({ ttlMinutes: 15 }).expect(200)).body;
    await as(faculty).delete(`/circulars/${circular.id}/attendance-token`).expect(200);
    await as(asha).post('/attendance/preview').send({ token: last.token }).expect(404);
  });

  it('suggests editable metadata while leaving the circular unpublished', async () => {
    const count = db.prepare('SELECT count(*) AS n FROM circulars').get().n;
    const result = (await as(faculty).post('/suggest').send({ text: 'Emergency: evacuate the campus immediately and follow the safety instructions.' }).expect(200)).body.suggestions;
    assert.equal(result.category, 'emergency');
    assert.equal(result.priority, 'emergency');
    assert.equal(result.requiresAcknowledgment, true);
    assert.equal(db.prepare('SELECT count(*) AS n FROM circulars').get().n, count);
  });
});
