'use strict';

const { getDb } = require('../db/connection');
const { validate, ValidationError, AppError, helpers } = require('./validation');
const audit = require('./audit.service');
const acl = require('./acl.service');

/**
 * Income and expense entries with categories and a monthly report.
 * Kept deliberately simple - the specification asks for bookkeeping, not accounting.
 */

const CATEGORIES = {
  expense: ['Utilities', 'Maintenance', 'Stationery', 'Transport', 'Salaries', 'Events', 'Repairs', 'Other'],
  income: ['Admission', 'Donation', 'Event', 'Other Income'],
};

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

function assertOffice(session) {
  if (!acl.isAdminLike(session)) throw new AppError('FORBIDDEN', 'FORBIDDEN');
}

const SPEC = {
  entryType: helpers.enum(['income', 'expense'], { default: 'expense' }),
  category: helpers.text({ min: 1, max: 60 }),
  description: helpers.text({ max: 200 }),
  amount: helpers.number({ min: 1, max: 10000000, required: true }),
  method: helpers.enum(['cash', 'bank', 'cheque', 'online']),
  reference: helpers.text({ max: 60 }),
  entryDate: helpers.date({ required: true }),
};

/**
 * An update is partial: whatever the caller sends is validated, anything they
 * leave out keeps its stored value. `entryType`/`amount` stay optional here,
 * so editing only the amount does not require resending the date.
 */
const UPDATE_SPEC = {
  entryType: helpers.enum(['income', 'expense']),
  category: helpers.text({ min: 1, max: 60 }),
  description: helpers.text({ max: 200 }),
  amount: helpers.number({ min: 1, max: 10000000 }),
  method: helpers.enum(['cash', 'bank', 'cheque', 'online']),
  reference: helpers.text({ max: 60 }),
  entryDate: helpers.date(),
};

function list({ month, entryType, category, search, page = 1, pageSize = 50 } = {}, session) {
  assertOffice(session);
  const clean = validate({ month, entryType, category, search, page, pageSize }, {
    month: helpers.text({ max: 7 }),
    entryType: helpers.enum(['income', 'expense']),
    category: helpers.text({ max: 60 }),
    search: helpers.text({ max: 100, default: '' }),
    page: helpers.int({ min: 1, default: 1 }),
    pageSize: helpers.int({ min: 5, max: 500, default: 50 }),
  });

  const db = getDb();
  const where = ['e.is_deleted = 0'];
  const params = {};

  if (clean.month) {
    where.push("strftime('%Y-%m', e.entry_date) = @month");
    params.month = clean.month;
  }
  if (clean.entryType) {
    where.push('e.entry_type = @entryType');
    params.entryType = clean.entryType;
  }
  if (clean.category) {
    where.push('e.category = @category');
    params.category = clean.category;
  }
  if (clean.search) {
    where.push(`(e.description LIKE @search OR e.category LIKE @search OR e.reference LIKE @search)`);
    params.search = `%${clean.search}%`;
  }

  const clause = `WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS n FROM expenses e ${clause}`).get(params).n;
  const rows = db
    .prepare(`SELECT e.*, u.username FROM expenses e LEFT JOIN users u ON u.id = e.created_by ${clause}
              ORDER BY e.entry_date DESC, e.id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: clean.pageSize, offset: (clean.page - 1) * clean.pageSize });

  return {
    total,
    page: clean.page,
    pageSize: clean.pageSize,
    rows: rows.map(shape),
    summary: db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN e.entry_type = 'income'  THEN e.amount ELSE 0 END),0) AS income,
                COALESCE(SUM(CASE WHEN e.entry_type = 'expense' THEN e.amount ELSE 0 END),0) AS expense
         FROM expenses e ${clause}`,
      )
      .get(params),
  };
}

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    entryType: row.entry_type,
    category: row.category,
    description: row.description,
    amount: row.amount,
    method: row.method,
    reference: row.reference,
    entryDate: row.entry_date,
    username: row.username,
    isDeleted: !!row.is_deleted,
  };
}

function create(payload, session) {
  assertOffice(session);
  const clean = validate(payload, SPEC);
  const allowed = CATEGORIES[clean.entryType] || [];
  if (allowed.length && !allowed.includes(clean.category)) {
    throw new ValidationError({ category: 'invalid' });
  }

  const id = getDb()
    .prepare(
      `INSERT INTO expenses (entry_type, category, description, amount, method, reference, entry_date, created_by)
       VALUES (@entryType, @category, @description, @amount, @method, @reference, @entryDate, @createdBy)`,
    )
    .run({
      entryType: clean.entryType,
      category: clean.category,
      description: clean.description ?? null,
      amount: money(clean.amount),
      method: clean.method ?? null,
      reference: clean.reference ?? null,
      entryDate: clean.entryDate,
      createdBy: session ? session.userId : null,
    }).lastInsertRowid;

  audit.log({ action: 'create', entity: 'expenses', entityId: id, details: clean, session });
  return getDb().prepare(`SELECT * FROM expenses WHERE id = ?`).get(id);
}

function update(id, payload, session) {
  assertOffice(session);
  const db = getDb();
  if (!db.prepare(`SELECT id FROM expenses WHERE id = ? AND is_deleted = 0`).get(id)) {
    throw new AppError('NOT_FOUND', 'NOT_FOUND');
  }
  const clean = validate(payload, UPDATE_SPEC);

  // The category has to belong to the type the row ends up with, so an update
  // that flips expense -> income cannot keep an expense-only category.
  const current = db.prepare(`SELECT entry_type, category FROM expenses WHERE id = ? AND is_deleted = 0`).get(id);
  const finalType = clean.entryType ?? current.entry_type;
  const finalCategory = clean.category ?? current.category;
  const allowed = CATEGORIES[finalType] || [];
  if (allowed.length && !allowed.includes(finalCategory)) {
    throw new ValidationError({ category: 'invalid' });
  }

  db.prepare(
    `UPDATE expenses SET entry_type = COALESCE(@entryType, entry_type), category = COALESCE(@category, category),
       description = COALESCE(@description, description), amount = COALESCE(@amount, amount),
       method = COALESCE(@method, method), reference = COALESCE(@reference, reference),
       entry_date = COALESCE(@entryDate, entry_date), updated_at = datetime('now')
     WHERE id = @id`,
  ).run({
    id,
    entryType: clean.entryType ?? null,
    category: clean.category ?? null,
    description: clean.description ?? null,
    amount: clean.amount ?? null,
    method: clean.method ?? null,
    reference: clean.reference ?? null,
    entryDate: clean.entryDate ?? null,
  });

  audit.log({ action: 'update', entity: 'expenses', entityId: id, details: clean, session });
  return db.prepare(`SELECT * FROM expenses WHERE id = ?`).get(id);
}

function softDelete(id, session) {
  assertOffice(session);
  getDb().prepare(`UPDATE expenses SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
  audit.log({ action: 'delete', entity: 'expenses', entityId: id, session });
  return { ok: true };
}

/** Monthly totals by category, used by the Expenses page and the reports. */
function report({ month, year } = {}, session) {
  assertOffice(session);
  const clean = validate({ month, year }, {
    month: helpers.text({ max: 7 }),
    year: helpers.int({ min: 2000, max: 2100 }),
  });

  const db = getDb();
  const params = {};
  let filter = '';
  if (clean.month) {
    filter = " AND strftime('%Y-%m', entry_date) = @month";
    params.month = clean.month;
  } else if (clean.year) {
    filter = " AND strftime('%Y', entry_date) = @year";
    params.year = String(clean.year);
  }

  const byCategory = db
    .prepare(
      `SELECT entry_type, category, COALESCE(SUM(amount),0) AS amount, COUNT(*) AS entries
       FROM expenses WHERE is_deleted = 0${filter}
       GROUP BY entry_type, category ORDER BY entry_type, amount DESC`,
    )
    .all(params);

  const monthly = db
    .prepare(
      `SELECT strftime('%Y-%m', entry_date) AS month,
              COALESCE(SUM(CASE WHEN entry_type = 'income'  THEN amount ELSE 0 END),0) AS income,
              COALESCE(SUM(CASE WHEN entry_type = 'expense' THEN amount ELSE 0 END),0) AS expense
       FROM expenses WHERE is_deleted = 0${filter}
       GROUP BY month ORDER BY month`,
    )
    .all(params);

  const totals = byCategory.reduce(
    (acc, row) => {
      if (row.entry_type === 'income') acc.income = money(acc.income + row.amount);
      else acc.expense = money(acc.expense + row.amount);
      return acc;
    },
    { income: 0, expense: 0 },
  );

  return {
    month: clean.month || null,
    year: clean.year || null,
    byCategory,
    monthly,
    totals: { ...totals, net: money(totals.income - totals.expense) },
  };
}

module.exports = { CATEGORIES, list, create, update, softDelete, report };