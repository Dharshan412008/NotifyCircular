'use strict';
const { it } = require('node:test');
const request = require('supertest');
const { createApplication } = require('../src/app');

it('does not expose discussion discovery or chat mutation endpoints', async () => {
  const app = createApplication({ dbPath: ':memory:', envName: 'test', bcryptRounds: 4, disableOutboundNotifications: true });
  try {
    const faculty = request.agent(app.app);
    await faculty.post('/api/auth/login').send({ email: 'faculty@demo.edu', password: 'Faculty123!' }).expect(200);
    await faculty.get('/api/discussions').expect(404);
    await faculty.get('/api/discussions/1/messages').expect(404);
    await faculty.post('/api/discussions/1/messages').send({ text: 'Chat is removed' }).expect(404);
  } finally { app.close(); }
});
