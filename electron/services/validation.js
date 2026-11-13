'use strict';

/**
 * Tiny validation layer used by every service.
 * The renderer performs UX validation only - these rules are the real ones.
 */

class ValidationError extends Error {
  constructor(fields, message = 'VALIDATION_FAILED') {
    super(message);
    this.name = 'ValidationError';
    this.code = 'VALIDATION_FAILED';
    this.fields = fields;
  }
}

class AppError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.name = 'AppError';
    this.code = code;
    Object.assign(this, extra);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

function isBlank(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function checkRule(name, rule, raw, fields) {
  const fail = () => {
    fields[name] = rule.message || 'invalid';
    return undefined;
  };

  if (isBlank(raw)) {
    if (rule.required) return fail();
    return rule.default !== undefined ? rule.default : undefined;
  }

  switch (rule.type) {
    case 'string': {
      let v = String(raw);
      if (rule.trim !== false) v = v.trim();
      if (rule.lowercase) v = v.toLowerCase();
      if (rule.min && v.length < rule.min) return fail();
      if (rule.max && v.length > rule.max) return fail();
      if (rule.pattern && !rule.pattern.test(v)) return fail();
      return v;
    }
    case 'int':
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) return fail();
      if (rule.type === 'int' && !Number.isInteger(n)) return fail();
      if (rule.min !== undefined && n < rule.min) return fail();
      if (rule.max !== undefined && n > rule.max) return fail();
      return n;
    }
    case 'bool': {
      if (typeof raw === 'boolean') return raw;
      if (raw === 1 || raw === 0) return !!raw;
      if (raw === 'true' || raw === '1') return true;
      if (raw === 'false' || raw === '0') return false;
      return fail();
    }
    case 'date': {
      const v = String(raw).trim();
      const re = rule.month ? MONTH_RE : DATE_RE;
      if (!re.test(v)) return fail();
      if (!rule.month) {
        const d = new Date(`${v}T00:00:00Z`);
        if (Number.isNaN(d.getTime())) return fail();
      }
      return v;
    }
    case 'enum': {
      const v = String(raw).trim();
      return rule.values.includes(v) ? v : fail();
    }
    case 'array': {
      if (!Array.isArray(raw)) return fail();
      if (rule.min && raw.length < rule.min) return fail();
      if (rule.max && raw.length > rule.max) return fail();
      return raw;
    }
    default:
      return fail();
  }
}

/**
 * @param {object} payload untrusted renderer payload
 * @param {object} spec field name -> rule
 * @returns {object} sanitised values
 * @throws {ValidationError}
 */
function validate(payload, spec) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const out = {};
  const fields = {};

  for (const [name, rule] of Object.entries(spec)) {
    const value = checkRule(name, rule, source[name], fields);
    if (value !== undefined) out[name] = value;
  }

  if (Object.keys(fields).length > 0) throw new ValidationError(fields);
  return out;
}

/** Passwords: minimum 6 characters (spec), no trimming, must differ from username. */
function assertPassword(password, { username } = {}) {
  const fields = {};
  if (isBlank(password) || String(password).length < 6) fields.password = 'passwordTooShort';
  if (username && String(password || '').toLowerCase() === String(username).toLowerCase()) {
    fields.password = 'passwordSameAsUsername';
  }
  if (Object.keys(fields).length) throw new ValidationError(fields);
  return String(password);
}

/**
 * Login only checks that something was typed - length/username rules belong to
 * the "set a password" flows, otherwise seeded accounts (where the default
 * password equals the username) could never sign in.
 */
function assertPasswordInput(password) {
  if (isBlank(password)) throw new ValidationError({ password: 'required' });
  return String(password);
}

const helpers = {
  text: (opts = {}) => ({ type: 'string', ...opts }),
  int: (opts = {}) => ({ type: 'int', ...opts }),
  number: (opts = {}) => ({ type: 'number', ...opts }),
  bool: (opts = {}) => ({ type: 'bool', ...opts }),
  date: (opts = {}) => ({ type: 'date', ...opts }),
  month: (opts = {}) => ({ type: 'date', month: true, ...opts }),
  enum: (values, opts = {}) => ({ type: 'enum', values, ...opts }),
  array: (opts = {}) => ({ type: 'array', ...opts }),
};

module.exports = { validate, assertPassword, assertPasswordInput, ValidationError, AppError, helpers, isBlank, DATE_RE };