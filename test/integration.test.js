'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, it } = require('node:test');
const request = require('supertest');

const { createApplication } = require('../src/app');

describe('NotifyCircular API', () => {
  let context;
  let app;
  let faculty;
  let arjun;
  let asha;
  let ravi;
  let groups;

  async function login(agent, email, password) {
    const response = await agent.post('/api/auth/login').send({ email, password }).expect(200);
    return response.body.user;
  }

  before(async () => {
    context = createApplication({
      dbPath: ':memory:',
      envName: 'test',
      bcryptRounds: 4,
      disableOutboundNotifications: true,
    });
    app = context.app;
    faculty = request.agent(app);
    arjun = request.agent(app);
    asha = request.agent(app);
    ravi = request.agent(app);
    await login(faculty, 'faculty@demo.edu', 'Faculty123!');
    await login(arjun, 'arjun@demo.edu', 'Faculty123!');
    await login(asha, 'asha@demo.edu', 'Student123!');
    await login(ravi, 'ravi@demo.edu', 'Student123!');
    groups = (await faculty.get('/api/groups').expect(200)).body.groups;
  });

  after(() => {
    context.close();
  });

  it('reports health and exposes no user before login', async () => {
    await request(app).get('/api/health').expect(200, { ok: true, service: 'notify-circular' });
    await request(app).get('/api/auth/me').expect(200, { user: null });
    const publicGroups = await request(app).get('/api/groups').expect(200);
    assert(publicGroups.body.groups.length > 0);
    assert(publicGroups.body.groups.every((group) => group.joinable));
    const response = await request(app).get('/api/inbox').expect(401);
    assert.equal(response.body.error.code, 'authentication_required');
  });

  it('marks the entire authorized student inbox read without acknowledging or touching other audiences', async (testContext) => {
    const bulkContext = createApplication({ dbPath: ':memory:', envName: 'test', bcryptRounds: 4, disableOutboundNotifications: true });
    testContext.after(() => bulkContext.close());
    const student = request.agent(bulkContext.app);
    const teacher = request.agent(bulkContext.app);
    const studentUser = await login(student, 'asha@demo.edu', 'Student123!');
    const teacherUser = await login(teacher, 'faculty@demo.edu', 'Faculty123!');
    const studentGroup = bulkContext.db.prepare("SELECT id FROM groups WHERE slug = 'first-year'").get();
    const excludedGroup = bulkContext.db.prepare("SELECT id FROM groups WHERE slug = 'final-year'").get();
    const ids = bulkContext.db.transaction(() => {
      const addCircular = bulkContext.db.prepare(`INSERT INTO circulars (faculty_id, text, created_at, summary, urgency, requires_acknowledgment) VALUES (?, 'Read all test notice', ?, 'Read all test', 'urgent', 1)`);
      const addTarget = bulkContext.db.prepare('INSERT INTO circular_targets (circular_id, group_id) VALUES (?, ?)');
      return Array.from({ length: 106 }, (_, index) => {
        const id = Number(addCircular.run(teacherUser.id, new Date().toISOString()).lastInsertRowid);
        addTarget.run(id, index === 105 ? excludedGroup.id : studentGroup.id);
        return id;
      });
    })();
    await request(bulkContext.app).post('/api/inbox/read-all').expect(401);
    await teacher.post('/api/inbox/read-all').expect(403);
    const previous = (await student.post(`/api/circulars/${ids[0]}/ack`).expect(200)).body.status;
    const beforeCount = Number(bulkContext.db.prepare('SELECT count(*) AS count FROM circular_reads').get().count);
    const result = await student.post('/api/inbox/read-all').send({ circularIds: [ids[105]], studentId: teacherUser.id }).expect(200);
    assert(result.body.updatedCount >= 104);
    assert(!result.body.circularIds.includes(ids[0]));
    assert(!result.body.circularIds.includes(ids[105]));
    assert.equal(result.body.circularIds.length, new Set(result.body.circularIds).size);
    assert.equal(result.body.updatedCount, result.body.circularIds.length);
    for (const id of ids.slice(1, 105)) {
      const status = bulkContext.db.prepare('SELECT read_at, acknowledged_at FROM circular_reads WHERE circular_id = ? AND student_id = ?').get(id, studentUser.id);
      assert.equal(status.read_at, result.body.readAt);
      assert.equal(status.acknowledged_at, null);
    }
    const existing = bulkContext.db.prepare('SELECT read_at, acknowledged_at FROM circular_reads WHERE circular_id = ? AND student_id = ?').get(ids[0], studentUser.id);
    assert.equal(existing.read_at, previous.readAt);
    assert.equal(existing.acknowledged_at, previous.acknowledgedAt);
    assert.equal(bulkContext.db.prepare('SELECT 1 FROM circular_reads WHERE circular_id = ? AND student_id = ?').get(ids[105], studentUser.id), undefined);
    assert.equal(Number(bulkContext.db.prepare('SELECT count(*) AS count FROM circular_reads').get().count), beforeCount + result.body.updatedCount);
    const repeated = await student.post('/api/inbox/read-all').expect(200);
    assert.equal(repeated.body.updatedCount, 0);
  });

  it('serves an injected Vite build and explicit React Router routes', async (testContext) => {
    const distPath = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-circular-dist-'));
    let frontendContext;
    testContext.after(() => {
      frontendContext?.close();
      fs.rmSync(distPath, { recursive: true, force: true });
    });
    const indexHtml = '<!doctype html><html><body><div id="root">Vite fixture</div></body></html>';
    fs.mkdirSync(path.join(distPath, 'assets'));
    fs.mkdirSync(path.join(distPath, 'api'));
    fs.mkdirSync(path.join(distPath, 'socket.io'));
    fs.writeFileSync(path.join(distPath, 'index.html'), indexHtml);
    fs.writeFileSync(path.join(distPath, 'assets', 'app.js'), 'globalThis.viteFixture = true;');
    fs.writeFileSync(path.join(distPath, 'manifest.webmanifest'), '{"name":"Vite fixture"}');
    fs.writeFileSync(path.join(distPath, 'sw.js'), 'globalThis.serviceWorkerFixture = true;');
    fs.writeFileSync(path.join(distPath, 'icon.svg'), '<svg id="icon"></svg>');
    fs.writeFileSync(path.join(distPath, 'maskable.svg'), '<svg id="maskable"></svg>');
    fs.writeFileSync(path.join(distPath, '.secret'), 'must not be served');
    fs.writeFileSync(path.join(distPath, 'api', 'frontend.txt'), 'must not shadow the API');
    fs.writeFileSync(path.join(distPath, 'socket.io', 'frontend.txt'), 'must not shadow Socket.IO');

    frontendContext = createApplication({
      dbPath: ':memory:',
      distPath,
      envName: 'test',
      bcryptRounds: 4,
      disableOutboundNotifications: true,
    });

    for (const route of ['/', '/faculty', '/faculty/sent', '/student', '/student/notices/1']) {
      const response = await request(frontendContext.app)
        .get(route)
        .expect('Content-Type', /html/)
        .expect(200);
      assert.equal(response.text, indexHtml);
    }

    const asset = await request(frontendContext.app).get('/assets/app.js').expect(200);
    assert.equal(asset.text, 'globalThis.viteFixture = true;');
    const manifest = await request(frontendContext.app)
      .get('/manifest.webmanifest')
      .expect('Content-Type', /application\/manifest\+json/)
      .expect('Cache-Control', 'no-cache')
      .expect(200);
    assert.deepEqual(manifest.body, { name: 'Vite fixture' });
    const worker = await request(frontendContext.app)
      .get('/sw.js')
      .expect('Content-Type', /javascript/)
      .expect('Cache-Control', 'no-cache')
      .expect('Service-Worker-Allowed', '/')
      .expect(200);
    assert.equal(worker.text, 'globalThis.serviceWorkerFixture = true;');
    for (const [route, marker] of [['/icon.svg', 'icon'], ['/maskable.svg', 'maskable']]) {
      const image = await request(frontendContext.app)
        .get(route)
        .expect('Content-Type', /image\/svg\+xml/)
        .expect('Cache-Control', 'no-cache')
        .expect(200);
      assert.match(image.text || image.body.toString('utf8'), new RegExp(`id="${marker}"`));
    }
    await request(frontendContext.app)
      .get('/api/health')
      .expect(200, { ok: true, service: 'notify-circular' });
    for (const route of [
      '/api/frontend.txt',
      '/%61pi/frontend.txt',
      '/api%2Ffrontend.txt',
      '/%61pi%2Ffrontend.txt',
      '/API/frontend.txt',
      '/%41PI/frontend.txt',
      '/socket.io/frontend.txt',
      '/%73ocket.io/frontend.txt',
      '/socket.io%2Ffrontend.txt',
      '/Socket.IO/frontend.txt',
    ]) {
      await request(frontendContext.app).get(route).expect(404);
    }
    await request(frontendContext.app).get('/.secret').expect(404);
    await request(frontendContext.app).get('/%73w.js').expect(404);
    await request(frontendContext.app).get('/package.json').expect(404);
    await request(frontendContext.app).get('/facultyish').expect(404);
    await request(frontendContext.app).get('/unrelated').expect(404);
  });

  it('uses real credentials and a persisted session', async () => {
    const invalid = await request(app)
      .post('/api/auth/login')
      .send({ email: 'faculty@demo.edu', password: 'wrong-password' })
      .expect(401);
    assert.equal(invalid.body.error.code, 'invalid_credentials');

    const me = await faculty.get('/api/auth/me').expect(200);
    assert.equal(me.body.user.role, 'faculty');
    assert.equal(me.body.user.email, 'faculty@demo.edu');
  });

  it('strictly filters seeded inboxes by actual membership', async () => {
    const ashaInbox = (await asha.get('/api/inbox').expect(200)).body.circulars;
    const raviInbox = (await ravi.get('/api/inbox').expect(200)).body.circulars;

    assert(ashaInbox.some((circular) => circular.targets.some((group) => group.slug === 'sports')));
    assert(!ashaInbox.some((circular) => circular.targets.some((group) => group.slug === 'final-year')));
    assert(raviInbox.some((circular) => circular.targets.some((group) => group.slug === 'final-year')));
    assert(!raviInbox.some((circular) => circular.targets.some((group) => group.slug === 'sports')));
    assert(ashaInbox.some((circular) => circular.targets.some((group) => group.slug === 'whole-college')));
    assert(raviInbox.some((circular) => circular.targets.some((group) => group.slug === 'whole-college')));
  });

  it('auto-assigns year and broadcast memberships at student registration', async () => {
    const newStudent = request.agent(app);
    const registered = await newStudent
      .post('/api/auth/register')
      .send({
        name: 'Neha Patel',
        email: 'neha@example.edu',
        password: 'SecurePass123!',
        year: 2,
      })
      .expect(201);
    assert.equal(registered.body.user.role, 'student');
    assert.equal(registered.body.user.year, 2);

    const memberships = await newStudent.get('/api/memberships').expect(200);
    const slugs = memberships.body.memberships.map((group) => group.slug);
    assert.deepEqual([...slugs].sort(), ['second-year', 'whole-college']);
    assert.deepEqual(
      [...memberships.body.groupIds].sort((a, b) => a - b),
      memberships.body.memberships.map((group) => group.id).sort((a, b) => a - b),
    );

    const inbox = (await newStudent.get('/api/inbox').expect(200)).body.circulars;
    assert(inbox.some((circular) => circular.targets.some((group) => group.slug === 'whole-college')));
    assert(!inbox.some((circular) => circular.targets.some((group) => group.slug === 'sports')));

    const sports = groups.find((group) => group.slug === 'sports');
    await newStudent
      .post('/api/memberships')
      .send({ groupId: sports.id, joined: true })
      .expect(200);
    const joinedInbox = (await newStudent.get('/api/inbox').expect(200)).body.circulars;
    assert(joinedInbox.some((circular) => circular.targets.some((group) => group.slug === 'sports')));
  });

  it('classifies indirect wording locally and detects date, urgency, and summary', async () => {
    const response = await faculty
      .post('/api/copilot/typeahead')
      .send({
        text: 'Urgent: players must report for the match against St. Xavier\'s on 15 September 2026.',
      })
      .expect(200);
    assert.equal(response.body.suggestedGroups[0].slug, 'sports');
    assert(response.body.suggestedGroups[0].confidence >= 0.5);
    assert.equal(response.body.detectedDate, '2026-09-15');
    assert.equal(response.body.detectedDateText, '15 September 2026');
    assert.equal(response.body.urgency, 'urgent');
    assert.match(response.body.summary, /players must report/i);
  });

  it('creates a multi-user targeted circular and excludes non-members', async () => {
    const sports = groups.find((group) => group.slug === 'sports');
    const created = await faculty
      .post('/api/circulars')
      .send({
        text: 'Mandatory team briefing is on 20 September 2026 at the main ground.',
        groupIds: [sports.id],
        detectedDate: '2026-09-20',
        urgency: 'urgent',
        summary: 'Sports team briefing on 20 September.',
        requiresAcknowledgment: true,
      })
      .expect(201);
    assert.equal(created.body.circular.targets.length, 1);
    assert.equal(created.body.circular.targets[0].slug, 'sports');
    assert.equal(created.body.delivery.audienceCount, 2);

    const circularId = created.body.circular.id;
    const ashaIds = (await asha.get('/api/inbox').expect(200)).body.circulars.map((item) => item.id);
    const raviIds = (await ravi.get('/api/inbox').expect(200)).body.circulars.map((item) => item.id);
    assert(ashaIds.includes(circularId));
    assert(!raviIds.includes(circularId));

    const forbidden = await ravi.post(`/api/circulars/${circularId}/read`).expect(404);
    assert.equal(forbidden.body.error.code, 'circular_not_found');
    const studentCreate = await asha
      .post('/api/circulars')
      .send({ text: 'Students cannot send this.', groupIds: [sports.id] })
      .expect(403);
    assert.equal(studentCreate.body.error.code, 'forbidden');
  });

  it('tracks reads and required acknowledgments for faculty accountability', async () => {
    const inbox = (await asha.get('/api/inbox').expect(200)).body.circulars;
    const urgent = inbox.find(
      (circular) => circular.requiresAcknowledgment && /team briefing/i.test(circular.summary),
    );
    assert(urgent);

    const read = await asha.post(`/api/circulars/${urgent.id}/read`).expect(200);
    assert(read.body.status.readAt);
    assert.equal(read.body.status.acknowledgedAt, null);
    const acknowledgment = await asha.post(`/api/circulars/${urgent.id}/ack`).expect(200);
    assert(acknowledgment.body.status.acknowledgedAt);

    const detail = await faculty.get(`/api/circulars/${urgent.id}/accountability`).expect(200);
    const ashaRecipient = detail.body.circular.recipients.find(
      (recipient) => recipient.email === 'asha@demo.edu',
    );
    assert(ashaRecipient.readAt);
    assert(ashaRecipient.acknowledgedAt);
    assert.equal(detail.body.circular.stats.acknowledged, 1);

    const normal = inbox.find((circular) => !circular.requiresAcknowledgment);
    const notRequired = await asha.post(`/api/circulars/${normal.id}/ack`).expect(409);
    assert.equal(notRequired.body.error.code, 'acknowledgment_not_required');
    const normalAccountability = await faculty
      .get(`/api/circulars/${normal.id}/accountability`)
      .expect(200);
    assert.equal(normalAccountability.body.circular.stats.pendingAcknowledgment, 0);
  });

  it('delivers Faculty Group notices to provisioned faculty with recipient accountability', async () => {
    const facultyGroup = groups.find((group) => group.slug === 'faculty');
    assert(facultyGroup);
    assert.equal(facultyGroup.memberCount, 2);
    assert.equal(facultyGroup.isMember, true);

    const created = await faculty
      .post('/api/circulars')
      .send({
        text: 'Mandatory faculty council is on 2 October 2026. All lecturers must attend.',
        groupIds: [facultyGroup.id],
        detectedDate: '2026-10-02',
        urgency: 'urgent',
        summary: 'Mandatory faculty council on 2 October.',
        requiresAcknowledgment: true,
      })
      .expect(201);
    const circularId = created.body.circular.id;
    assert.equal(created.body.delivery.audienceCount, 2);
    assert.equal(created.body.circular.stats.pendingRead, 2);
    assert.equal(created.body.circular.stats.pendingAcknowledgment, 2);

    const received = (await arjun.get('/api/inbox').expect(200)).body.circulars;
    const notice = received.find((circular) => circular.id === circularId);
    assert(notice);
    assert.equal(notice.readAt, null);
    assert.equal(notice.acknowledgedAt, null);

    const detail = await arjun.get(`/api/circulars/${circularId}`).expect(200);
    assert.equal(detail.body.circular.id, circularId);
    assert.equal(detail.body.circular.recipients, undefined);
    await arjun.get(`/api/circulars/${circularId}/download.txt`).expect(200);
    await arjun.get(`/api/circulars/${circularId}/calendar.ics`).expect(200);
    await arjun.post(`/api/circulars/${circularId}/read`).expect(200);
    await arjun.post(`/api/circulars/${circularId}/ack`).expect(200);
    await arjun.get(`/api/circulars/${circularId}/accountability`).expect(404);

    const accountability = await faculty
      .get(`/api/circulars/${circularId}/accountability`)
      .expect(200);
    const arjunRecipient = accountability.body.circular.recipients.find(
      (recipient) => recipient.email === 'arjun@demo.edu',
    );
    assert(arjunRecipient.readAt);
    assert(arjunRecipient.acknowledgedAt);
    assert.equal(accountability.body.circular.stats.read, 1);
    assert.equal(accountability.body.circular.stats.pendingRead, 1);
    assert.equal(accountability.body.circular.stats.acknowledged, 1);
    assert.equal(accountability.body.circular.stats.pendingAcknowledgment, 1);
  });

  it('lets faculty create a usable custom group and manage its members', async () => {
    const created = await faculty
      .post('/api/groups')
      .send({ name: 'Robotics Club', description: 'Robots, electronics and automation', icon: 'RB' })
      .expect(201);
    const group = created.body.group;
    assert.equal(group.kind, 'custom');

    const students = (await faculty.get('/api/students').expect(200)).body.students;
    const raviUser = students.find((student) => student.email === 'ravi@demo.edu');
    assert(raviUser);
    const updated = await faculty
      .put(`/api/groups/${group.id}/members`)
      .send({ studentIds: [raviUser.id] })
      .expect(200);
    assert.deepEqual(updated.body.memberIds, [raviUser.id]);
    assert(updated.body.students.find((student) => student.id === raviUser.id).isMember);

    const members = await faculty.get(`/api/groups/${group.id}/members`).expect(200);
    assert.deepEqual(members.body.memberIds, [raviUser.id]);

    const locked = groups.find((candidate) => candidate.slug === 'first-year');
    const rejected = await faculty
      .put(`/api/groups/${locked.id}/members`)
      .send({ studentIds: [raviUser.id] })
      .expect(403);
    assert.equal(rejected.body.error.code, 'membership_locked');
  });

  it('exports authorized notices as text and valid all-day ICS', async () => {
    const inbox = (await asha.get('/api/inbox').expect(200)).body.circulars;
    const dated = inbox.find((circular) => circular.detectedDate);
    assert(dated);

    const text = await asha.get(`/api/circulars/${dated.id}/download.txt`).expect(200);
    assert.match(text.headers['content-type'], /^text\/plain/);
    assert.match(text.headers['content-disposition'], /attachment/);
    assert.match(text.text, /OFFICIAL COLLEGE NOTICE/);

    const calendar = await asha.get(`/api/circulars/${dated.id}/calendar.ics`).expect(200);
    assert.match(calendar.headers['content-type'], /^text\/calendar/);
    assert(calendar.text.startsWith('BEGIN:VCALENDAR\r\n'));
    assert.match(calendar.text, /BEGIN:VEVENT\r\n/);
    assert.match(calendar.text, /DTSTART;VALUE=DATE:\d{8}\r\n/);
    assert(calendar.text.endsWith('END:VCALENDAR\r\n'));

    const noDate = inbox.find((circular) => !circular.detectedDate);
    const missing = await asha.get(`/api/circulars/${noDate.id}/calendar.ics`).expect(422);
    assert.equal(missing.body.error.code, 'date_required');
  });

  it('provides local VAPID setup and validates push subscriptions', async () => {
    const key = await request(app).get('/api/push/key').expect(200);
    assert.equal(typeof key.body.publicKey, 'string');
    assert(key.body.publicKey.length > 20);

    const invalid = await asha
      .post('/api/push/subscribe')
      .send({ subscription: { endpoint: 'not-a-url', keys: { p256dh: 'abcdefgh', auth: 'abcd' } } })
      .expect(400);
    assert.equal(invalid.body.error.code, 'validation_error');

    for (const endpoint of ['https://127.0.0.1/push', 'https://localhost/push']) {
      const unsafe = await asha
        .post('/api/push/subscribe')
        .send({
          subscription: {
            endpoint,
            expirationTime: null,
            keys: { p256dh: 'example-p256dh-key', auth: 'example-auth-key' },
          },
        })
        .expect(400);
      assert.equal(unsafe.body.error.code, 'validation_error');
    }

    await asha
      .post('/api/push/subscribe')
      .send({
        subscription: {
          endpoint: 'https://push.example.test/subscription/asha',
          expirationTime: null,
          keys: { p256dh: 'example-p256dh-key', auth: 'example-auth-key' },
        },
      })
      .expect(201, { ok: true });
  });

  it('rejects malformed input without leaking server internals', async () => {
    const badDate = await faculty
      .post('/api/circulars')
      .send({
        text: 'This date is deliberately invalid.',
        groupIds: [groups[0].id],
        detectedDate: '2026-02-31',
      })
      .expect(400);
    assert.equal(badDate.body.error.code, 'validation_error');

    const invalidJson = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{broken')
      .expect(400);
    assert.equal(invalidJson.body.error.code, 'invalid_json');
  });
});
