'use strict';

const { randomUUID } = require('node:crypto');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

function applySecurity(app, { env = process.env, options = {} } = {}) {
  const production = (options.envName || env.NODE_ENV || app.get('env')) === 'production';
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: production ? ["'self'"] : ["'self'", 'ws://localhost:5173', 'ws://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5173'],
      fontSrc: ["'self'", 'data:'], objectSrc: ["'none'"], frameAncestors: ["'none'"],
      upgradeInsecureRequests: production ? [] : null,
    } },
    strictTransportSecurity: production ? undefined : false,
    referrerPolicy: { policy: 'same-origin' },
    crossOriginEmbedderPolicy: false,
  }));
  app.use((req, res, next) => {
    const requestId = randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (options.requestLogger || env.REQUEST_LOGGING === 'true') {
      const started = performance.now();
      res.on('finish', () => {
        // Route templates avoid writing emails, tokens, query strings, or bodies.
        const entry = { requestId, method: req.method, route: req.route?.path || 'unmatched', status: res.statusCode, durationMs: Math.round(performance.now() - started) };
        if (options.requestLogger) options.requestLogger(entry);
        else process.stdout.write(`${JSON.stringify(entry)}\n`);
      });
    }
    if (!req.path.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('Origin');
    if (!origin) {
      if (req.get('Sec-Fetch-Site') === 'cross-site') return res.status(403).json({ error: { code: 'cross_origin_request', message: 'Open CampusRelay in its own tab and try again.' } });
      return next();
    }
    const allowed = new Set([`${req.protocol}://${req.get('host')}`]);
    if (!production) for (const local of ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://127.0.0.1:3000']) allowed.add(local);
    if (env.APP_URL) {
      try { allowed.add(new URL(env.APP_URL).origin); } catch { /* Invalid configuration does not broaden access. */ }
    }
    if (!allowed.has(origin)) return res.status(403).json({ error: { code: 'cross_origin_request', message: 'Open CampusRelay in its own tab and try again.' } });
    return next();
  });
  const limiter = rateLimit({
    windowMs: Number(options.authRateWindowMs || 15 * 60 * 1000),
    limit: Number(options.authRateLimit || env.AUTH_RATE_LIMIT || 100),
    standardHeaders: 'draft-8', legacyHeaders: false, skipSuccessfulRequests: true,
    message: { error: { code: 'too_many_attempts', message: 'Too many sign-in attempts. Please try again later.' } },
  });
  app.use(['/api/auth/login', '/api/auth/register', '/api/auth/google/start', '/api/auth/google/callback'], limiter);
  app.use('/api/auth/verification', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30,
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { code: 'too_many_attempts', message: 'Too many verification requests. Please try again later.' } },
  }));
}

module.exports = { applySecurity };
