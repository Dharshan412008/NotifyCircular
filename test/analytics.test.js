'use strict';
const assert = require('node:assert/strict');
const { it } = require('node:test');
const request = require('supertest');
const { createApplication } = require('../src/app');
const { createCircular, markCircular } = require('../src/repository');
const { facultyAnalytics } = require('../src/analytics');

it('deduplicates audiences, separates unique reach from reads, and excludes other faculty and dates', async () => {
  const context = createApplication({ dbPath: ':memory:', envName: 'test', bcryptRounds: 4, disableOutboundNotifications: true });
  try {
    const db = context.db;
    const faculty = db.prepare("SELECT id FROM users WHERE email='faculty@demo.edu'").get().id;
    const other = db.prepare("SELECT id FROM users WHERE email='arjun@demo.edu'").get().id;
    const asha = db.prepare("SELECT id FROM users WHERE email='asha@demo.edu'").get().id;
    const ravi = db.prepare("SELECT id FROM users WHERE email='ravi@demo.edu'").get().id;
    const groups = db.prepare("SELECT id FROM groups WHERE slug IN ('first-year','whole-college')").all().map((g) => g.id);
    const send = (facultyId, date, ack) => createCircular(db, { facultyId, text: 'Analytics test notice', summary: 'Analytics test', targetGroupIds: groups, urgency: 'normal', detectedDate: null, detectedDateText: null, createdAt: date, requiresAcknowledgment: ack });
    const first = send(faculty, '2030-01-02T12:00:00.000Z', true);
    send(faculty, '2030-01-03T12:00:00.000Z', false);
    send(other, '2030-01-03T12:00:00.000Z', true);
    send(faculty, '2029-12-01T12:00:00.000Z', true);
    db.prepare('INSERT INTO circular_reads(circular_id,student_id,read_at,acknowledged_at) VALUES(?,?,?,?)').run(first.id, asha, '2030-01-03T13:00:00.000Z', '2030-01-03T13:00:00.000Z');
    const result = facultyAnalytics(db, faculty, 7, new Date('2030-01-04T15:00:00.000Z'));
    assert.equal(result.summary.sent, 2);
    assert.equal(result.summary.uniqueRecipients, 2);
    assert.equal(result.summary.recipientOpportunities, 4);
    assert.equal(result.summary.readRate, 25);
    assert.equal(result.summary.pendingAcknowledgments, 1);
    assert.equal(result.summary.acknowledgmentRate, 50);
    assert.equal(result.daily.length, 7);
    assert.equal(result.daily.filter((day) => day.sent === 0).length, 5);
    db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(ravi);
    assert.equal(facultyAnalytics(db, faculty, 7, new Date('2030-01-04T15:00:00.000Z')).summary.pendingAcknowledgments, 0);
    const student = request.agent(context.app);
    await student.post('/api/auth/login').send({ email: 'asha@demo.edu', password: 'Student123!' }).expect(200);
    await student.get('/api/platform/analytics').expect(403);
    const teacher = request.agent(context.app);
    await teacher.post('/api/auth/login').send({ email: 'faculty@demo.edu', password: 'Faculty123!' }).expect(200);
    await teacher.get('/api/platform/analytics?days=366').expect(400);
    await teacher.get('/api/platform/analytics?days=7').expect(200);
  } finally { context.close(); }
});
