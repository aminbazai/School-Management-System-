'use strict';

const { getDb } = require('../db/connection');
const { validate, ValidationError, AppError, helpers } = require('./validation');
const audit = require('./audit.service');

/**
 * Key/value application settings (school profile, rules, UI preferences).
 * Values are stored as text and typed by DEFAULTS.
 */

const DEFAULTS = {
  school_name: 'School Management System',
  school_address: '',
  school_phone: '',
  school_email: '',
  logo_path: '',
  session: '2025-2026',
  currency: 'PKR',
  currency_symbol: 'Rs',
  language: 'en',
  theme: 'dark',
  attendance_cutoff: '08:30',
  late_after: '08:45',
  working_days: 'Mon,Tue,Wed,Thu,Fri,Sat',
  min_password_length: 6,
  max_failed_attempts: 5,
  lockout_minutes: 5,
  session_timeout_minutes: 30,
  late_fine_amount: 0,
  absent_deduction_per_day: 0,
  report_footer: '',
  auto_print_receipt: '1',
};

const PUBLIC_KEYS = Object.keys(DEFAULTS);

function getAll() {
  const db = getDb();
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const result = {};
  for (const key of PUBLIC_KEYS) {
    const raw = stored[key] ?? DEFAULTS[key];
    const numeric = ['min_password_length', 'max_failed_attempts', 'lockout_minutes', 'session_timeout_minutes', 'late_fine_amount', 'absent_deduction_per_day'];
    result[key] = numeric.includes(key) ? Number(raw) : raw;
  }
  return result;
}

function get(key) {
  const all = getAll();
  return all[key];
}

/** Public subset safe for every authenticated user (branding, language, theme). */
function getPublic() {
  const all = getAll();
  return {
    school_name: all.school_name,
    school_address: all.school_address,
    school_phone: all.school_phone,
    school_email: all.school_email,
    logo_path: all.logo_path,
    session: all.session,
    currency: all.currency,
    currency_symbol: all.currency_symbol,
    language: all.language,
    theme: all.theme,
    attendance_cutoff: all.attendance_cutoff,
    late_after: all.late_after,
    working_days: all.working_days,
    report_footer: all.report_footer,
  };
}

const EDITABLE = {
  school_name: helpers.text({ min: 1, max: 120 }),
  school_address: helpers.text({ max: 300 }),
  school_phone: helpers.text({ max: 40 }),
  school_email: helpers.text({ max: 120 }),
  logo_path: helpers.text({ max: 400 }),
  session: helpers.text({ min: 1, max: 30 }),
  currency: helpers.text({ min: 1, max: 10 }),
  currency_symbol: helpers.text({ min: 1, max: 10 }),
  language: helpers.enum(['en', 'ur']),
  theme: helpers.enum(['dark', 'light']),
  attendance_cutoff: helpers.text({ max: 5 }),
  late_after: helpers.text({ max: 5 }),
  working_days: helpers.text({ max: 120 }),
  report_footer: helpers.text({ max: 300 }),
  auto_print_receipt: helpers.enum(['0', '1']),
  min_password_length: helpers.int({ min: 6, max: 64 }),
  max_failed_attempts: helpers.int({ min: 3, max: 10 }),
  lockout_minutes: helpers.int({ min: 1, max: 120 }),
  session_timeout_minutes: helpers.int({ min: 5, max: 480 }),
  late_fine_amount: helpers.number({ min: 0, max: 100000 }),
  absent_deduction_per_day: helpers.number({ min: 0, max: 100000 }),
};

function update(payload, session) {
  const clean = validate(payload || {}, EDITABLE);

  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO settings (key, value, updated_at, updated_by)
     VALUES (@key, @value, datetime('now'), @by)
     ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = datetime('now'), updated_by = @by`,
  );

  const changed = [];
  const apply = db.transaction(() => {
    for (const [key, value] of Object.entries(clean)) {
      if (get(key) === value) continue;
      stmt.run({ key, value: String(value), by: session ? session.userId : null });
      changed.push(key);
    }
  });
  apply();

  if (changed.length) {
    audit.log({ action: 'settings.update', entity: 'settings', details: changed, session });
  }
  return getAll();
}

// ---------------------------------------------------------------------------
// Grade scale (results, report cards)
// ---------------------------------------------------------------------------

function listGradeScale() {
  return getDb()
    .prepare(`SELECT * FROM grade_scale WHERE is_active = 1 ORDER BY max_percentage DESC`)
    .all();
}

function saveGradeScale(payload, session) {
  const clean = validate(payload, {
    id: helpers.int({ min: 1 }),
    name: helpers.text({ min: 1, max: 10 }),
    minPercentage: helpers.number({ min: 0, max: 100 }),
    maxPercentage: helpers.number({ min: 0, max: 100 }),
    gradePoint: helpers.number({ min: 0, max: 10, default: 0 }),
  });

  if (clean.minPercentage > clean.maxPercentage) {
    throw new ValidationError({ minPercentage: 'invalid' });
  }

  const db = getDb();
  const overlap = db
    .prepare(
      `SELECT name FROM grade_scale
       WHERE is_active = 1 AND id <> COALESCE(@id, 0)
         AND NOT (max_percentage < @min OR min_percentage > @max)`,
    )
    .get({ id: clean.id ?? null, min: clean.minPercentage, max: clean.maxPercentage });
  if (overlap) throw new ValidationError({ name: 'alreadyExists' });

  if (clean.id) {
    db.prepare(
      `UPDATE grade_scale SET name = @name, min_percentage = @minPercentage,
         max_percentage = @maxPercentage, grade_point = @gradePoint WHERE id = @id`,
    ).run(clean);
    audit.log({ action: 'update', entity: 'grade_scale', entityId: clean.id, details: clean, session });
    return listGradeScale();
  }

  const id = db
    .prepare(
      `INSERT INTO grade_scale (name, min_percentage, max_percentage, grade_point)
       VALUES (@name, @minPercentage, @maxPercentage, @gradePoint)`,
    )
    .run(clean).lastInsertRowid;
  audit.log({ action: 'create', entity: 'grade_scale', entityId: id, details: clean, session });
  return listGradeScale();
}

function deleteGradeScale(id, session) {
  const row = getDb().prepare(`SELECT * FROM grade_scale WHERE id = ?`).get(id);
  if (!row) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  getDb().prepare(`UPDATE grade_scale SET is_active = 0 WHERE id = ?`).run(id);
  audit.log({ action: 'delete', entity: 'grade_scale', entityId: id, details: { name: row.name }, session });
  return listGradeScale();
}

module.exports = { DEFAULTS, getAll, get, getPublic, update, listGradeScale, saveGradeScale, deleteGradeScale };