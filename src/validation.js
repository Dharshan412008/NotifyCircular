'use strict';

const { ApiError, assert } = require('./errors');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function requireObject(value, label = 'Request body') {
  assert(
    value && typeof value === 'object' && !Array.isArray(value),
    400,
    'invalid_request',
    `${label} must be a JSON object.`,
  );
  return value;
}

function cleanString(value, field, options = {}) {
  const {
    required = true,
    min = 0,
    max = 255,
    trim = true,
    allowNull = false,
  } = options;

  if ((value === null && allowNull) || (value === undefined && !required)) {
    return value;
  }
  assert(typeof value === 'string', 400, 'validation_error', `${field} must be a string.`, {
    field,
  });
  const result = trim ? value.trim() : value;
  assert(result.length >= min, 400, 'validation_error', `${field} is too short.`, {
    field,
    min,
  });
  assert(result.length <= max, 400, 'validation_error', `${field} is too long.`, {
    field,
    max,
  });
  return result;
}

function cleanEmail(value) {
  const email = cleanString(value, 'email', { min: 3, max: 254 }).toLowerCase();
  assert(EMAIL_PATTERN.test(email), 400, 'validation_error', 'Enter a valid email address.', {
    field: 'email',
  });
  return email;
}

function cleanPassword(value) {
  const password = cleanString(value, 'password', {
    min: 8,
    max: 128,
    trim: false,
  });
  assert(
    Buffer.byteLength(password, 'utf8') <= 72,
    400,
    'validation_error',
    'Password must be at most 72 UTF-8 bytes.',
    { field: 'password' },
  );
  return password;
}

function cleanInteger(value, field, options = {}) {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = options;
  const number = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
  assert(Number.isSafeInteger(number), 400, 'validation_error', `${field} must be an integer.`, {
    field,
  });
  assert(number >= min && number <= max, 400, 'validation_error', `${field} is out of range.`, {
    field,
    min,
    max,
  });
  return number;
}

function cleanIdArray(value, field, options = {}) {
  const { min = 0, max = 50 } = options;
  assert(Array.isArray(value), 400, 'validation_error', `${field} must be an array.`, { field });
  assert(value.length >= min, 400, 'validation_error', `${field} needs at least ${min} item(s).`, {
    field,
    min,
  });
  assert(value.length <= max, 400, 'validation_error', `${field} has too many items.`, {
    field,
    max,
  });
  const ids = value.map((item) => cleanInteger(item, field, { min: 1 }));
  return [...new Set(ids)];
}

function cleanBoolean(value, field, defaultValue) {
  if (value === undefined && defaultValue !== undefined) return defaultValue;
  assert(typeof value === 'boolean', 400, 'validation_error', `${field} must be a boolean.`, {
    field,
  });
  return value;
}

function cleanIsoDate(value, field = 'detectedDate', options = {}) {
  const { allowNull = false } = options;
  if (value === null && allowNull) return null;
  const input = cleanString(value, field, { min: 10, max: 10 });
  assert(ISO_DATE_PATTERN.test(input), 400, 'validation_error', `${field} must use YYYY-MM-DD.`, {
    field,
  });
  const [year, month, day] = input.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  assert(
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day,
    400,
    'validation_error',
    `${field} is not a valid calendar date.`,
    { field },
  );
  return input;
}

function slugify(value) {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!slug) throw new ApiError(400, 'validation_error', 'Name must contain a letter or number.');
  return slug;
}

module.exports = {
  requireObject,
  cleanString,
  cleanEmail,
  cleanPassword,
  cleanInteger,
  cleanIdArray,
  cleanBoolean,
  cleanIsoDate,
  slugify,
};
