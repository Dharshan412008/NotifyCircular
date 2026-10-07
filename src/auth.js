'use strict';

const { ApiError } = require('./errors');
const { serializeUser } = require('./repository');

function attachCurrentUser(db) {
  const getUser = db.prepare('SELECT id, name, email, role, year, disabled FROM users WHERE id = ?');
  return function currentUserMiddleware(req, _res, next) {
    try {
      const row = req.session?.userId ? getUser.get(req.session.userId) : null;
      req.user = row && !row.disabled ? serializeUser(row) : null;
      if (!req.user && req.session?.userId) delete req.session.userId;
      next();
    } catch (error) {
      next(error);
    }
  };
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(new ApiError(401, 'authentication_required', 'Please log in first.'));
  next();
}

function requireRole(role) {
  return function roleMiddleware(req, _res, next) {
    if (!req.user) return next(new ApiError(401, 'authentication_required', 'Please log in first.'));
    if (req.user.role !== role) {
      return next(
        new ApiError(403, 'forbidden', `This action requires a ${role} account.`),
      );
    }
    next();
  };
}

module.exports = { attachCurrentUser, requireAuth, requireRole };
