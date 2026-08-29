'use strict';

const http = require('node:http');
const { Server: SocketIOServer } = require('socket.io');
const { createApplication } = require('./src/app');
const { audienceRows, hydrateCircular } = require('./src/repository');

function createApp(options = {}) {
  return createApplication(options).app;
}

function createServer(options = {}) {
  const context = createApplication(options);
  const httpServer = http.createServer(context.app);
  const io = new SocketIOServer(httpServer, {
    serveClient: true,
    transports: ['websocket', 'polling'],
  });

  io.engine.use(context.sessionMiddleware);
  io.use((socket, next) => {
    const userId = Number(socket.request.session?.userId);
    if (!Number.isSafeInteger(userId) || userId < 1) {
      const error = new Error('Authentication required');
      error.data = { code: 'authentication_required' };
      return next(error);
    }
    const user = context.db
      .prepare('SELECT id, name, email, role, year FROM users WHERE id = ?')
      .get(userId);
    if (!user) return next(new Error('Authentication required'));
    socket.data.user = user;
    return next();
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.user.id}`);
    socket.emit('session:ready', { userId: Number(socket.data.user.id) });
  });

  context.app.locals.publishCircular = (circular) => {
    for (const recipient of audienceRows(context.db, circular.id)) {
      io.to(`user:${recipient.id}`).emit(
        'circular:new',
        hydrateCircular(context.db, circular.id, { studentId: recipient.id }),
      );
    }
    io.to(`user:${circular.faculty.id}`).emit('circular:created', circular);
  };
  context.app.locals.disconnectUserSockets = (userId) => {
    io.in(`user:${userId}`).disconnectSockets(true);
  };

  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await new Promise((resolve) => io.close(resolve));
    if (httpServer.listening) {
      await new Promise((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
    context.close();
  }

  return {
    ...context,
    httpServer,
    io,
    listen(...args) {
      return httpServer.listen(...args);
    },
    close,
  };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`NotifyCircular is running at http://${host}:${port}`);
    console.log('Faculty demo: faculty@demo.edu / Faculty123!');
    console.log('Student demos: asha@demo.edu or ravi@demo.edu / Student123!');
  });

  const shutdown = async () => {
    try {
      await server.close();
      process.exit(0);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

module.exports = { createApp, createServer };
