'use strict';
const assert = require('node:assert/strict');
const { it } = require('node:test');
const request = require('supertest');
const { createApplication } = require('../src/app');

it('creates faculty/admin groups with persisted options and exactly the chosen audience', async () => {
  const app = createApplication({ dbPath: ':memory:', envName: 'test', bcryptRounds: 4, disableOutboundNotifications: true });
  try {
    const faculty = request.agent(app.app), student = request.agent(app.app), admin = request.agent(app.app);
    for (const [agent, email, password] of [[faculty, 'faculty@demo.edu', 'Faculty123!'], [student, 'asha@demo.edu', 'Student123!'], [admin, 'admin@demo.edu', 'Admin123!']]) await agent.post('/api/auth/login').send({ email, password }).expect(200);
    await request(app.app).get('/api/groups/create-options').expect(401);
    await student.get('/api/groups/create-options').expect(403);
    const options = (await faculty.get('/api/groups/create-options').expect(200)).body;
    const asha = options.students.find((s) => s.email === 'asha@demo.edu');
    const ravi = options.students.find((s) => s.email === 'ravi@demo.edu');
    const parent = options.groups.find((g) => g.name === 'Whole College');
    const members = (id) => app.db.prepare('SELECT student_id FROM student_group_memberships WHERE group_id=? ORDER BY student_id').all(id).map((r) => r.student_id);
    const create = async (agent,base,payload) => { const result=(await agent.post(base).send(payload).expect(201)).body; return result.group || (await admin.post(`/api/community/requests/${result.requestId}/review`).send({decision:'approve'}).expect(200)).body.group; };
    const empty = await create(faculty,'/api/groups',{name:'Empty community'});
    assert.deepEqual(members(empty.id), []);
    const manual = await create(faculty,'/api/groups',{name:'Manual community',memberStudentIds:[ravi.id]});
    assert.deepEqual(members(manual.id), [ravi.id]);
    await student.put('/api/platform/profile').send({ name: 'Asha Rao', department: 'Computing', section: 'A', register_number: '', program: '', academic_year: '', bio: '' }).expect(200);
    await faculty.put('/api/platform/profile').send({ name:'Dr Meera Shah',department:'Computing',section:'',register_number:'',program:'',academic_year:'',bio:'' }).expect(200);
    for (const [agent, base, suffix] of [[faculty, '/api/groups', 'Faculty'], [admin, '/api/admin/groups', 'Admin']]) {
      const payload = { name: `${suffix} computing group`, description: 'Section A workshops', icon: 'CS', kind: 'activity', joinable: false, year: 1, department: 'computing', section: 'a', parentGroupId: parent.id, memberStudentIds: [asha.id] };
      const group = await create(agent,base,payload);
      assert.equal(group.section, 'a'); assert.equal(group.year, 1); assert.equal(group.department, 'computing');
      assert.equal(group.kind, 'activity'); assert.equal(group.joinable, false); assert.equal(group.icon, 'CS');
      assert.deepEqual(members(group.id), [asha.id]);
      await agent.post(base).send({ ...payload, name: `${suffix} wrong class`, autoAddMatches: false, memberStudentIds: [ravi.id], joinable: true, kind: 'custom' }).expect(400);
      await agent.post(base).send({ ...payload, name: `${suffix} bad section`, section: 'x'.repeat(31) }).expect(400);
    }
    app.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(ravi.id);
    await faculty.post('/api/groups').send({ name: 'Disabled member', memberStudentIds: [ravi.id] }).expect(400);
    assert(!(await admin.get('/api/admin/groups/create-options').expect(200)).body.students.some((s) => s.id === ravi.id));
  } finally { app.close(); }
});
