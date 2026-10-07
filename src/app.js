'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const { WORKSPACE_ROOT, openDatabase, getSetting, setSetting, utcNow } = require('./db');
const { SQLiteSessionStore } = require('./session-store');
const { NotificationService } = require('./notifications');
const { attachCurrentUser, requireAuth, requireRole } = require('./auth');
const { ApiError, assert, asyncRoute, notFound, errorHandler } = require('./errors');
const {
  cleanBoolean,
  cleanEmail,
  cleanIdArray,
  cleanInteger,
  cleanIsoDate,
  cleanPassword,
  cleanString,
  requireObject,
  slugify,
} = require('./validation');
const {
  audienceRows,
  circularBaseRow,
  createCircular,
  getGroup,
  getMembershipGroups,
  hydrateCircular,
  listFacultyCirculars,
  listFacultyInbox,
  listGroups,
  listStudentInbox,
  markCircular,
  serializeGroup,
  serializeUser,
  studentCanAccessCircular,
  userCanReceiveCircular,
} = require('./repository');
const { circularToIcs, circularToText } = require('./exports');
const { analyzeText } = require('./classifier');

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

function normalizeRequestPath(requestPath) {
  try {
    return path.posix.normalize(decodeURIComponent(requestPath).replaceAll('\\', '/'));
  } catch {
    return null;
  }
}

const blockedPushAddresses = new net.BlockList();
for (const [address, prefix, family] of [
  ['0.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'],
  ['240.0.0.0', 4, 'ipv4'],
  ['::', 128, 'ipv6'],
  ['::1', 128, 'ipv6'],
  ['::ffff:0:0', 96, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
  ['ff00::', 8, 'ipv6'],
]) {
  blockedPushAddresses.addSubnet(address, prefix, family);
}

function isUnsafePushHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const version = net.isIP(host);
  if (version) return blockedPushAddresses.check(host, version === 4 ? 'ipv4' : 'ipv6');
  if (
    !host ||
    !host.includes('.') ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa')
  ) {
    return true;
  }
  return false;
}

function parsePagination(query) {
  return {
    limit:
      query.limit === undefined ? 100 : cleanInteger(query.limit, 'limit', { min: 1, max: 100 }),
    offset:
      query.offset === undefined
        ? 0
        : cleanInteger(query.offset, 'offset', { min: 0, max: 100_000 }),
  };
}

function ensureUniqueExistingGroups(db, ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM groups WHERE id IN (${placeholders})`).all(...ids);
  assert(
    rows.length === ids.length,
    400,
    'validation_error',
    'One or more target groups do not exist.',
    { field: 'targetGroupIds' },
  );
  return rows;
}

function getAccessibleCircular(db, req, options = {}) {
  const id = cleanInteger(req.params.id, 'id', { min: 1 });
  const row = circularBaseRow(db, id);
  if (!row) throw new ApiError(404, 'circular_not_found', 'Circular was not found.');

  if (req.user.role === 'faculty') {
    const isOwner = Number(row.faculty_id) === req.user.id;
    if (!isOwner && (options.ownerOnly || !userCanReceiveCircular(db, req.user.id, id))) {
      throw new ApiError(404, 'circular_not_found', 'Circular was not found.');
    }
    if (!isOwner) return hydrateCircular(db, row, { recipientId: req.user.id });
    return hydrateCircular(db, row, {
      includeStats: true,
      includeRecipients: Boolean(options.includeRecipients),
    });
  }

  if (!studentCanAccessCircular(db, req.user.id, id)) {
    throw new ApiError(404, 'circular_not_found', 'Circular was not found in your inbox.');
  }
  return hydrateCircular(db, row, { recipientId: req.user.id });
}

function createApplication(options = {}) {
  const env = options.env || process.env;
  if (env.NODE_ENV === 'production' && String(options.sessionSecret || env.SESSION_SECRET || '').length < 32) {
    throw new Error('Production requires SESSION_SECRET with at least 32 characters.');
  }
  const db = options.db || openDatabase({
    filename: options.dbPath,
    seed: options.seed,
    env,
    bcryptRounds: options.bcryptRounds,
  });
  const app = express();
  app.disable('x-powered-by');
  app.set('env', options.envName || env.NODE_ENV || 'development');
  if (env.TRUST_PROXY) app.set('trust proxy', Number(env.TRUST_PROXY) || 1);
  require('./security').applySecurity(app, { env, options });

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const jsonParser = express.json({ limit: '64kb', type: ['application/json', 'application/*+json'] });
  app.use((req, res, next) => req.path === '/api/posts' || req.path.startsWith('/api/posts/') || req.path === '/api/circular-tools/attachments' ? next() : jsonParser(req, res, next));

  let sessionSecret = options.sessionSecret || env.SESSION_SECRET || getSetting(db, 'session_secret');
  if (!sessionSecret) {
    sessionSecret = crypto.randomBytes(32).toString('base64url');
    setSetting(db, 'session_secret', sessionSecret);
  }
  const cookieMaxAge = Number(env.SESSION_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000);
  const sessionMiddleware = session({
    name: 'notify.sid',
    secret: sessionSecret,
    store: options.sessionStore || new SQLiteSessionStore(db, { defaultTtlMs: cookieMaxAge }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      maxAge: cookieMaxAge,
    },
  });
  app.use(sessionMiddleware);
  app.use(attachCurrentUser(db));
  app.use('/api/posts', require('./campus').campusRouter(db));
  app.use('/api/admin', require('./admin').adminRouter(db));
  app.use('/api/reports', require('./admin').reportsRouter(db));
  app.use('/api/platform', require('./platform').platformRouter(db));
  app.get('/api/config', (_req, res) => res.json(require('./admin').getCollegeConfig(db)));

  const notificationService =
    options.notificationService ||
    new NotificationService(db, {
      disabled: options.disableOutboundNotifications,
      env,
    });

  app.locals.db = db;
  app.locals.sessionMiddleware = sessionMiddleware;
  app.locals.notificationService = notificationService;
  app.locals.publishCircular = () => {};
  app.locals.disconnectUserSockets = () => {};
  app.locals.publishCampus = () => {};
  app.locals.publishNotification = () => {};
  const circularTools = require('./circular-tools').createCircularTools({
    db, notificationService, publicOrigin: env.PUBLIC_ORIGIN,
    publishCircular: (circular) => app.locals.publishCircular(circular),
    onError: (error) => console.error('Scheduled circular failed:', error.message),
  });
  app.use('/api/circular-tools', circularTools.router);
  if (app.get('env') !== 'test') {
    circularTools.startScheduler();
    notificationService.startDigestScheduler?.();
  }

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'notify-circular' });
  });

  app.get('/api/auth/me', (req, res) => {
    res.json({ user: req.user || null });
  });

  app.post(
    '/api/auth/login',
    asyncRoute(async (req, res) => {
      const body = requireObject(req.body);
      const email = cleanEmail(body.email);
      const password = cleanString(body.password, 'password', {
        min: 1,
        max: 128,
        trim: false,
      });
      const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      const valid = row && !row.disabled ? await bcrypt.compare(password, row.password_hash) : false;
      if (!valid) {
        throw new ApiError(401, 'invalid_credentials', 'Email or password is incorrect.');
      }
      await regenerateSession(req);
      req.session.userId = Number(row.id);
      require('./admin').audit(db, { actorId: Number(row.id), action: 'login', resource: 'user', resourceId: Number(row.id) });
      res.json({ user: serializeUser(row) });
    }),
  );

  app.post(
    '/api/auth/register',
    asyncRoute(async (req, res) => {
      const body = requireObject(req.body);
      const name = cleanString(body.name, 'name', { min: 2, max: 100 });
      assert(require('./admin').getCollegeConfig(db).registrationOpen, 403, 'registration_closed', 'Registration is currently closed. Contact your college administrator.');
      const email = cleanEmail(body.email);
      const password = cleanPassword(body.password);
      const year = cleanInteger(body.year, 'year', { min: 1, max: 4 });
      const activityGroupIds =
        body.activityGroupIds === undefined
          ? []
          : cleanIdArray(body.activityGroupIds, 'activityGroupIds', { max: 25 });

      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
        throw new ApiError(409, 'email_in_use', 'An account already exists for this email.');
      }

      let activityGroups = [];
      if (activityGroupIds.length) {
        activityGroups = ensureUniqueExistingGroups(db, activityGroupIds);
        assert(
          activityGroups.every(
            (group) => group.joinable && ['activity', 'custom'].includes(group.kind),
          ),
          400,
          'validation_error',
          'Students may only join optional activity groups.',
          { field: 'activityGroupIds' },
        );
      }

      const passwordHash = await bcrypt.hash(
        password,
        options.bcryptRounds || (app.get('env') === 'test' ? 4 : 10),
      );
      const now = utcNow();
      const userId = db.transaction(() => {
        const result = db
          .prepare(`
            INSERT INTO users (name, email, password_hash, role, year, created_at)
            VALUES (?, ?, ?, 'student', ?, ?)
          `)
          .run(name, email, passwordHash, year, now);
        const id = Number(result.lastInsertRowid);
        const automaticGroups = db
          .prepare(`
            SELECT id FROM groups
            WHERE (kind = 'year' AND year = ?) OR kind = 'broadcast'
          `)
          .all(year);
        const addMembership = db.prepare(`
          INSERT INTO student_group_memberships
            (student_id, group_id, source, joined_at)
          VALUES (?, ?, ?, ?)
        `);
        for (const group of automaticGroups) {
          addMembership.run(id, group.id, 'automatic', now);
        }
        for (const group of activityGroups) {
          addMembership.run(id, group.id, 'self', now);
        }
        return id;
      })();

      await regenerateSession(req);
      req.session.userId = userId;
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      res.status(201).json({ user: serializeUser(user) });
    }),
  );

  app.post(
    '/api/auth/logout',
    asyncRoute(async (req, res) => {
      const userId = req.user?.id;
      if (req.session) await destroySession(req);
      if (userId) app.locals.disconnectUserSockets(userId);
      res.clearCookie('notify.sid', { httpOnly: true, sameSite: 'lax' });
      res.json({ ok: true });
    }),
  );

  app.get('/api/groups', (req, res) => {
    const groups = listGroups(db, req.user);
    // Before login, expose only groups a registering student may choose.
    res.json({ groups: req.user ? groups : groups.filter((group) => group.joinable) });
  });

  app.get('/api/students', requireRole('faculty'), (_req, res) => {
    const students = db
      .prepare(`
        SELECT id, name, email, role, year
        FROM users
        WHERE role = 'student'
        ORDER BY name COLLATE NOCASE, id
      `)
      .all()
      .map((student) => {
        const user = serializeUser(student);
        const profile = db.prepare('SELECT department FROM user_profiles WHERE user_id = ?').get(student.id);
        return { id: user.id, name: user.name, email: user.email, year: user.year, department: profile?.department || '' };
      });
    res.json({ students });
  });

  app.get('/api/groups/create-options', requireRole('faculty'), (_req, res) => res.json(require('./group-creation').groupOptions(db)));
  app.post('/api/groups', requireRole('faculty'), (req, res) => {
    res.status(201).json({ group: require('./group-creation').createGroup(db, req.user, req.body) });
  });

  app.get('/api/memberships', requireRole('student'), (req, res) => {
    const memberships = getMembershipGroups(db, req.user.id);
    res.json({ groupIds: memberships.map((group) => group.id), memberships });
  });

  app.post(
    '/api/memberships',
    requireRole('student'),
    asyncRoute(async (req, res) => {
      const body = requireObject(req.body);
      const groupId = cleanInteger(body.groupId, 'groupId', { min: 1 });
      const joined = cleanBoolean(body.joined, 'joined');
      const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
      if (!row) throw new ApiError(404, 'group_not_found', 'Group was not found.');
      assert(
        row.joinable && ['activity', 'custom'].includes(row.kind),
        403,
        'membership_locked',
        'This membership is assigned automatically and cannot be changed.',
      );
      if (joined) {
        db.prepare(`
          INSERT OR IGNORE INTO student_group_memberships
            (student_id, group_id, source, joined_at)
          VALUES (?, ?, 'self', ?)
        `).run(req.user.id, groupId, utcNow());
      } else {
        db.prepare(
          'DELETE FROM student_group_memberships WHERE student_id = ? AND group_id = ?',
        ).run(req.user.id, groupId);
      }
      const memberships = getMembershipGroups(db, req.user.id);
      res.json({ groupIds: memberships.map((group) => group.id), memberships });
    }),
  );

  app.put(
    '/api/memberships',
    requireRole('student'),
    asyncRoute(async (req, res) => {
      const body = requireObject(req.body);
      const groupIds = cleanIdArray(body.groupIds, 'groupIds', { max: 50 });
      const groups = ensureUniqueExistingGroups(db, groupIds);
      assert(
        groups.every((group) => group.joinable && ['activity', 'custom'].includes(group.kind)),
        400,
        'validation_error',
        'groupIds may only contain optional activity groups.',
        { field: 'groupIds' },
      );
      db.transaction(() => {
        db.prepare(`
          DELETE FROM student_group_memberships
          WHERE student_id = ?
            AND group_id IN (SELECT id FROM groups WHERE joinable = 1)
        `).run(req.user.id);
        const add = db.prepare(`
          INSERT INTO student_group_memberships
            (student_id, group_id, source, joined_at)
          VALUES (?, ?, 'self', ?)
        `);
        const now = utcNow();
        for (const groupId of groupIds) add.run(req.user.id, groupId, now);
      })();
      const memberships = getMembershipGroups(db, req.user.id);
      res.json({ groupIds: memberships.map((group) => group.id), memberships });
    }),
  );

  app.get('/api/groups/:id/members', requireRole('faculty'), (req, res) => {
    const groupId = cleanInteger(req.params.id, 'id', { min: 1 });
    const group = getGroup(db, groupId);
    if (!group) throw new ApiError(404, 'group_not_found', 'Group was not found.');
    const students = db
      .prepare(`
        SELECT
          u.id, u.name, u.email, u.role, u.year,
          EXISTS (
            SELECT 1 FROM student_group_memberships m
            WHERE m.student_id = u.id AND m.group_id = ?
          ) AS is_member
        FROM users u
        WHERE u.role = 'student'
        ORDER BY u.name COLLATE NOCASE, u.id
      `)
      .all(groupId)
      .map((row) => ({ ...serializeUser(row), isMember: Boolean(row.is_member) }));
    res.json({
      group,
      members: students.filter((student) => student.isMember),
      memberIds: students.filter((student) => student.isMember).map((student) => student.id),
      students,
    });
  });

  app.put(
    '/api/groups/:id/members',
    requireRole('faculty'),
    asyncRoute(async (req, res) => {
      const groupId = cleanInteger(req.params.id, 'id', { min: 1 });
      const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
      if (!row) throw new ApiError(404, 'group_not_found', 'Group was not found.');
      assert(
        ['activity', 'custom'].includes(row.kind),
        403,
        'membership_locked',
        'Automatic year, role, and broadcast memberships cannot be replaced.',
      );
      const body = requireObject(req.body);
      const studentIds = cleanIdArray(body.studentIds, 'studentIds', { max: 500 });
      if (studentIds.length) {
        const placeholders = studentIds.map(() => '?').join(',');
        const count = db
          .prepare(`SELECT count(*) AS count FROM users WHERE role = 'student' AND id IN (${placeholders})`)
          .get(...studentIds).count;
        assert(
          Number(count) === studentIds.length,
          400,
          'validation_error',
          'One or more selected students do not exist.',
          { field: 'studentIds' },
        );
      }
      db.transaction(() => {
        db.prepare('DELETE FROM student_group_memberships WHERE group_id = ?').run(groupId);
        const add = db.prepare(`
          INSERT INTO student_group_memberships
            (student_id, group_id, source, joined_at)
          VALUES (?, ?, 'faculty', ?)
        `);
        const now = utcNow();
        for (const studentId of studentIds) add.run(studentId, groupId, now);
      })();
      const students = db
        .prepare(`
          SELECT u.id, u.name, u.email, u.role, u.year,
            EXISTS (
              SELECT 1 FROM student_group_memberships m
              WHERE m.student_id = u.id AND m.group_id = ?
            ) AS is_member
          FROM users u WHERE u.role = 'student'
          ORDER BY u.name COLLATE NOCASE, u.id
        `)
        .all(groupId)
        .map((student) => ({ ...serializeUser(student), isMember: Boolean(student.is_member) }));
      res.json({
        group: getGroup(db, groupId),
        members: students.filter((student) => student.isMember),
        memberIds: students.filter((student) => student.isMember).map((student) => student.id),
        students,
      });
    }),
  );

  app.post(
    '/api/copilot/typeahead',
    requireRole('faculty'),
    asyncRoute(async (req, res) => {
      const body = requireObject(req.body);
      const text = cleanString(body.text, 'text', { min: 0, max: 5000 });
      const groups = db.prepare('SELECT * FROM groups ORDER BY id').all().map(serializeGroup);
      res.json(analyzeText(text, groups));
    }),
  );

  app.post(
    '/api/circulars',
    requireRole('faculty'),
    asyncRoute(async (req, res) => {
      const body = requireObject(req.body);
      const text = cleanString(body.text, 'text', { min: 5, max: 5000 });
      const targetInput = body.targetGroupIds ?? body.groupIds;
      const targetGroupIds = cleanIdArray(targetInput, 'targetGroupIds', { min: 1, max: 25 });
      ensureUniqueExistingGroups(db, targetGroupIds);

      const groups = db.prepare('SELECT * FROM groups ORDER BY id').all().map(serializeGroup);
      const analysis = analyzeText(text, groups);
      const hasDateOverride = Object.prototype.hasOwnProperty.call(body, 'detectedDate');
      const detectedDate = hasDateOverride
        ? cleanIsoDate(body.detectedDate, 'detectedDate', { allowNull: true })
        : analysis.detectedDate;
      const urgency = body.urgency ?? analysis.urgency;
      assert(
        ['normal', 'urgent', 'fyi'].includes(urgency),
        400,
        'validation_error',
        'urgency must be normal, urgent, or fyi.',
        { field: 'urgency' },
      );
      const summary =
        body.summary === undefined
          ? analysis.summary
          : cleanString(body.summary, 'summary', { min: 3, max: 240 });
      const requiresAcknowledgment = cleanBoolean(
        body.requiresAcknowledgment,
        'requiresAcknowledgment',
        urgency === 'urgent',
      );

      const circular = createCircular(db, {
        facultyId: req.user.id,
        text,
        targetGroupIds,
        detectedDate,
        detectedDateText:
          detectedDate && detectedDate === analysis.detectedDate ? analysis.detectedDateText : null,
        urgency,
        summary,
        requiresAcknowledgment,
      });

      app.locals.publishCircular(circular);
      let delivery = {
        audienceCount: circular.stats.audience,
        pushCount: 0,
        emailFallbackCount: 0,
      };
      try {
        delivery = await notificationService.notifyCircular(circular);
      } catch (error) {
        if (app.get('env') !== 'test') {
          console.error(`Notification dispatch failed for circular ${circular.id}:`, error.message);
        }
      }
      res.status(201).json({ circular, delivery });
    }),
  );

  app.get('/api/circulars', requireRole('faculty'), (req, res) => {
    const pagination = parsePagination(req.query);
    res.json({ circulars: listFacultyCirculars(db, req.user.id, pagination) });
  });

  app.get('/api/circulars/:id/accountability', requireRole('faculty'), (req, res) => {
    res.json({
      circular: getAccessibleCircular(db, req, { includeRecipients: true, ownerOnly: true }),
    });
  });

  app.get('/api/circulars/:id', requireAuth, (req, res) => {
    res.json({
      circular: getAccessibleCircular(db, req, { includeRecipients: req.user.role === 'faculty' }),
    });
  });

  app.get('/api/inbox', requireAuth, (req, res) => {
    const pagination = parsePagination(req.query);
    let groupId = null;
    if (req.query.groupId !== undefined) {
      groupId = cleanInteger(req.query.groupId, 'groupId', { min: 1 });
      if (req.user.role === 'faculty') {
        const group = getGroup(db, groupId);
        if (!group || group.kind !== 'role') {
          throw new ApiError(403, 'not_a_member', 'You are not a member of this group.');
        }
      }
    }
    if (req.user.role === 'faculty') {
      res.json({ circulars: listFacultyInbox(db, req.user.id, { ...pagination, groupId }) });
      return;
    }
    if (groupId !== null) {
      const membership = db
        .prepare(`
          SELECT 1 FROM student_group_memberships
          WHERE student_id = ? AND group_id = ?
        `)
        .get(req.user.id, groupId);
      if (!membership) {
        throw new ApiError(403, 'not_a_member', 'You are not a member of this group.');
      }
    }
    res.json({ circulars: listStudentInbox(db, req.user.id, { ...pagination, groupId }) });
  });

  app.post('/api/inbox/read-all', requireRole('student'), (req, res) => {
    const result = db.transaction(() => {
      const circularIds = db.prepare(`
        SELECT DISTINCT c.id
        FROM circulars c
        JOIN circular_targets ct ON ct.circular_id = c.id
        JOIN student_group_memberships m ON m.group_id = ct.group_id
        LEFT JOIN circular_reads cr ON cr.circular_id = c.id AND cr.student_id = @studentId
        WHERE m.student_id = @studentId AND cr.read_at IS NULL
      `).all({ studentId: req.user.id }).map((row) => Number(row.id));
      const readAt = utcNow();
      const markRead = db.prepare(`
        INSERT INTO circular_reads (circular_id, student_id, read_at, acknowledged_at)
        VALUES (?, ?, ?, NULL)
        ON CONFLICT(circular_id, student_id) DO UPDATE SET
          read_at = coalesce(circular_reads.read_at, excluded.read_at)
      `);
      for (const circularId of circularIds) markRead.run(circularId, req.user.id, readAt);
      return { updatedCount: circularIds.length, circularIds, readAt };
    })();
    res.json(result);
  });

  app.post('/api/circulars/:id/read', requireAuth, (req, res) => {
    const circularId = cleanInteger(req.params.id, 'id', { min: 1 });
    res.json({ status: markCircular(db, circularId, req.user.id, false) });
  });

  app.post('/api/circulars/:id/ack', requireAuth, (req, res) => {
    const circularId = cleanInteger(req.params.id, 'id', { min: 1 });
    const circular = getAccessibleCircular(db, req);
    if (!circular.requiresAcknowledgment) {
      throw new ApiError(
        409,
        'acknowledgment_not_required',
        'This circular does not require an acknowledgment.',
      );
    }
    res.json({ status: markCircular(db, circularId, req.user.id, true) });
  });

  app.get('/api/circulars/:id/download.txt', requireAuth, (req, res) => {
    const circular = getAccessibleCircular(db, req);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="circular-${circular.id}.txt"`);
    res.send(circularToText(circular));
  });

  app.get('/api/circulars/:id/calendar.ics', requireAuth, (req, res) => {
    const circular = getAccessibleCircular(db, req);
    const calendar = circularToIcs(circular);
    if (!calendar) {
      throw new ApiError(422, 'date_required', 'This circular does not contain an event date.');
    }
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="circular-${circular.id}.ics"`);
    res.send(calendar);
  });

  app.get('/api/push/key', (_req, res) => {
    res.json({ publicKey: notificationService.getPublicKey() });
  });

  app.post(
    '/api/push/subscribe',
    requireAuth,
    asyncRoute(async (req, res) => {
      const body = requireObject(req.body);
      const subscription = requireObject(body.subscription, 'subscription');
      const endpoint = cleanString(subscription.endpoint, 'subscription.endpoint', {
        min: 10,
        max: 2048,
      });
      let parsedEndpoint;
      try {
        parsedEndpoint = new URL(endpoint);
      } catch {
        throw new ApiError(400, 'validation_error', 'Push endpoint must be a valid URL.', {
          field: 'subscription.endpoint',
        });
      }
      assert(
        parsedEndpoint.protocol === 'https:',
        400,
        'validation_error',
        'Push endpoint must use HTTPS.',
        { field: 'subscription.endpoint' },
      );
      assert(
        !parsedEndpoint.username &&
          !parsedEndpoint.password &&
          !parsedEndpoint.hash &&
          (!parsedEndpoint.port || parsedEndpoint.port === '443') &&
          !isUnsafePushHostname(parsedEndpoint.hostname),
        400,
        'validation_error',
        'Push endpoint must use a public HTTPS origin.',
        { field: 'subscription.endpoint' },
      );
      const keys = requireObject(subscription.keys, 'subscription.keys');
      const p256dh = cleanString(keys.p256dh, 'subscription.keys.p256dh', {
        min: 8,
        max: 512,
      });
      const auth = cleanString(keys.auth, 'subscription.keys.auth', { min: 4, max: 512 });
      let expirationTime = null;
      if (subscription.expirationTime !== undefined && subscription.expirationTime !== null) {
        assert(
          Number.isFinite(subscription.expirationTime) && subscription.expirationTime > Date.now(),
          400,
          'validation_error',
          'Push subscription expirationTime is invalid.',
          { field: 'subscription.expirationTime' },
        );
        expirationTime = Math.trunc(subscription.expirationTime);
      }
      notificationService.subscribe(req.user.id, {
        endpoint,
        expirationTime,
        keys: { p256dh, auth },
      });
      res.status(201).json({ ok: true });
    }),
  );

  app.delete(
    '/api/push/subscribe',
    requireAuth,
    asyncRoute(async (req, res) => {
      const body = requireObject(req.body);
      const endpoint = cleanString(body.endpoint, 'endpoint', { min: 10, max: 2048 });
      res.json({ ok: true, removed: notificationService.unsubscribe(req.user.id, endpoint) });
    }),
  );

  // Tests only serve a frontend when they inject a fixture, so repository build output cannot
  // change API test behavior. Development and production use the normal Vite output directory.
  const distPath =
    app.get('env') === 'test' && options.distPath === undefined
      ? null
      : path.resolve(options.distPath || path.join(WORKSPACE_ROOT, 'dist'));
  const distIndexPath = distPath ? path.join(distPath, 'index.html') : null;
  if (distIndexPath && fs.existsSync(distIndexPath)) {
    const distAssetsPath = path.join(distPath, 'assets');
    if (fs.existsSync(distAssetsPath)) {
      app.use('/assets', express.static(distAssetsPath, {
        dotfiles: 'deny',
        index: false,
        immutable: true,
        maxAge: '1y',
      }));
    }

    const publicFiles = new Map([
      ['/manifest.webmanifest', 'manifest.webmanifest'],
      ['/sw.js', 'sw.js'],
      ['/icon.svg', 'icon.svg'],
      ['/maskable.svg', 'maskable.svg'],
    ]);
    for (const [route, filename] of publicFiles) {
      const filePath = path.join(distPath, filename);
      if (!fs.existsSync(filePath)) continue;
      app.get(route, (_req, res) => {
        res.setHeader('Cache-Control', 'no-cache');
        if (filename === 'manifest.webmanifest') res.type('application/manifest+json');
        if (filename === 'sw.js') res.setHeader('Service-Worker-Allowed', '/');
        res.sendFile(filePath);
      });
    }

    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const normalizedPath = normalizeRequestPath(req.path);
      if (!normalizedPath) return next();
      const isFrontendRoute =
        normalizedPath === '/' ||
        normalizedPath === '/faculty' ||
        normalizedPath.startsWith('/faculty/') ||
        normalizedPath === '/student' ||
        normalizedPath.startsWith('/student/') || normalizedPath === '/admin' || normalizedPath.startsWith('/admin/');
      if (!isFrontendRoute) return next();
      res.setHeader('Cache-Control', 'no-cache');
      return res.sendFile(distIndexPath);
    });
  }

  app.use(notFound);
  app.use((error, req, res, next) => {
    if (error?.type === 'entity.parse.failed') {
      return errorHandler(
        new ApiError(400, 'invalid_json', 'Request body contains invalid JSON.'),
        req,
        res,
        next,
      );
    }
    return errorHandler(error, req, res, next);
  });

  return {
    app,
    db,
    sessionMiddleware,
    notificationService,
    close() {
      circularTools.close();
      notificationService.close?.();
      if (db.open) db.close();
    },
  };
}

module.exports = { createApplication };
