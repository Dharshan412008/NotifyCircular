'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApplication } = require('../src/app');

it('validates role-specific registration details and stores them with the account', async () => {
  const context = createApplication({ dbPath: ':memory:', envName: 'test', env: { AUTH_MODE: 'password' }, bcryptRounds: 4, disableOutboundNotifications: true });
  try {
    for (const role of ['student', 'faculty']) {
      const agent = request.agent(context.app);
      const profile = role === 'student'
        ? { department: 'Computer Science', register_number: 'CS123', program: 'BE', section: 'B', academic_year: '2026-2027', phone: '+91 9876543210' }
        : { department: 'Mechanical Engineering', employee_id: 'FAC123', designation: 'Professor', phone: '' };
      const body = { name: 'New User', email: `${role}@gmail.com`, password: 'SecurePass123!', role, ...(role === 'student' ? { year: 2 } : {}), profile };
      await agent.post('/api/auth/register').send({ ...body, profile: {} }).expect(400);
      await agent.post('/api/auth/register').send({ ...body, profile: { ...profile, phone: 'invalid' } }).expect(400);
      const missing = { ...profile }; delete missing[role === 'student' ? 'register_number' : 'employee_id'];
      await agent.post('/api/auth/register').send({ ...body, profile: missing }).expect(400);
      assert(!context.db.prepare('SELECT id FROM users WHERE email=?').get(body.email));
      const result = await agent.post('/api/auth/register').send(body).expect(201);
      assert.equal(result.body.user.role, role);
      const saved = (await agent.get('/api/platform/profile').expect(200)).body.profile;
      for (const [key, value] of Object.entries(profile)) assert.equal(saved[key], value);
      await agent.put('/api/platform/profile').send({ name: 'Updated Name', register_number: saved.register_number, department: saved.department, program: saved.program, section: saved.section, academic_year: saved.academic_year, bio: 'Updated bio' }).expect(200);
      const updated = (await agent.get('/api/platform/profile')).body.profile;
      assert.equal(updated.phone, profile.phone);
      if (role === 'faculty') assert.equal(updated.employee_id, 'FAC123');
    }
  } finally { context.close(); }
});
