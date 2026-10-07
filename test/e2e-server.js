'use strict';

const path = require('node:path');
const { createServer } = require('../server');

module.exports = async function startE2eServer() {
  const host = '127.0.0.1';
  const port = Number(process.env.E2E_PORT || 3100);
  const server = createServer({
    dbPath: ':memory:',
    distPath: path.resolve(__dirname, '..', 'dist'),
    envName: 'test',
    bcryptRounds: 4,
    disableOutboundNotifications: true,
  });

  await new Promise((resolve, reject) => {
    server.httpServer.once('error', reject);
    server.listen(port, host, () => {
      server.httpServer.off('error', reject);
      resolve();
    });
  });

  return async () => {
    await server.close();
  };
};
