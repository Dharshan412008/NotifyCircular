'use strict';

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function assert(condition, status, code, message, details) {
  if (!condition) throw new ApiError(status, code, message, details);
}

function asyncRoute(handler) {
  return function wrappedRoute(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function notFound(req, res) {
  res.status(404).json({
    error: {
      code: 'not_found',
      message: 'The requested resource was not found.',
    },
  });
}

function errorHandler(error, req, res, _next) {
  if (res.headersSent) return;

  const status = Number.isInteger(error.status) ? error.status : 500;
  const body = {
    error: {
      code: error.code || 'internal_error',
      message:
        status >= 500 && !error.expose
          ? 'An unexpected server error occurred.'
          : error.message,
    },
  };

  if (error.details !== undefined) body.error.details = error.details;
  if (status >= 500 && req.app.get('env') !== 'test') {
    console.error(error);
  }

  res.status(status).json(body);
}

module.exports = { ApiError, assert, asyncRoute, notFound, errorHandler };
