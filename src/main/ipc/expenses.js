'use strict';

const db = require('../db');
const {
  str, num, money, dateOrNull, today, pick, advance, monthRange, logActivity
} = require('../services/util');

const METHODS = ['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other'];
const KINDS = ['business', 'materials', 'reinvestment', 'loan', 'subscription',
  'personal', 'tax', 'other'];
const FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly'];

function buildFilter({ search, categoryId, kind, projectId, method, from, to }) {
  const where = [];
  const params = [];
  if (search) {
    where.push('(e.title LIKE ? OR e.payee LIKE ? OR e.reference LIKE ? OR e.notes LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (categoryId) { where.push('e.category_id = ?'); params.push(categoryId); }
  if (kind && KINDS.includes(kind)) { where.push('ec.kind = ?'); params.push(kind); }
  if (projectId) { where.push('e.project_id = ?'); params.push(projectId); }
  if (method) { where.push('e.method = ?'); params.push(method); }
  if (from) { where.push('e.spent_on >= ?'); params.push(from); }
  if (to) { where.push('e.spent_on <= ?'); params.push(to); }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

module.exports = {
  // -- categories ----------------------------------------------------------
  'expenses:categories': async ({ includeInactive } = {}) => db.query(`
    SELECT ec.*, COALESCE(x.used, 0) AS used
    FROM expense_categories ec
    LEFT JOIN (SELECT category_id, COUNT(*) AS used FROM expenses GROUP BY category_id) x
      ON x.category_id = ec.id
    ${includeInactive ? '' : 'WHERE ec.is_active = 1'}
    ORDER BY FIELD(ec.kind, ${KINDS.map((k) => `'${k}'`).join(',')}), ec.name ASC`),

  'expenses:saveCategory': async (payload) => {
    const name = str(payload.name, 120);
    const kind = pick(payload.kind, KINDS, 'business');
    if (!name) throw new Error('Category name is required.');
    if (payload.id) {
      await db.query(
        'UPDATE expense_categories SET name = ?, kind = ?, is_active = ? WHERE id = ?',
        [name, kind, payload.is_active === 0 ? 0 : 1, payload.id]
      );
      return { id: Number(payload.id) };
    }
    const result = await db.query(
      'INSERT INTO expense_categories (name, kind) VALUES (?, ?)', [name, kind]
    );
    return { id: result.insertId };
  },

  'expenses:deleteCategory': async ({ id }) => {
    const used = num(await db.scalar(
      'SELECT COUNT(*) FROM expenses WHERE category_id = ?', [id]
    ));
    if (used > 0) {
      // Keeping the category preserves the history on existing expense rows.
      await db.query('UPDATE expense_categories SET is_active = 0 WHERE id = ?', [id]);
      return { id, deactivated: true, used };
    }
    await db.query('DELETE FROM expense_categories WHERE id = ?', [id]);
    return { id, deactivated: false };
  },

  // -- one-off expenses ----------------------------------------------------
  'expenses:list': async (filters = {}) => {
    const { clause, params } = buildFilter(filters);
    /*
     * The rows and the three breakdowns are independent views of the same
     * filter, so they go to the database together rather than in sequence.
     */
    const [
      rows,
      totals,
      byCategory,
      byKind
    ] = await Promise.all([
      db.query(`
        SELECT e.*, ec.name AS category_name, ec.kind AS category_kind,
               p.title AS project_title, r.title AS recurring_title
        FROM expenses e
        LEFT JOIN expense_categories ec ON ec.id = e.category_id
        LEFT JOIN projects p ON p.id = e.project_id
        LEFT JOIN recurring_expenses r ON r.id = e.recurring_id
        ${clause}
        ORDER BY e.spent_on DESC, e.id DESC
        LIMIT 2000`, params),
      db.one(`
        SELECT COALESCE(SUM(e.amount), 0) AS total, COUNT(*) AS entries
        FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id
        ${clause}`, params),
      db.query(`
        SELECT COALESCE(ec.name, '(Uncategorised)') AS category_name,
               COALESCE(ec.kind, 'other') AS category_kind,
               COALESCE(SUM(e.amount), 0) AS total, COUNT(*) AS entries
        FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id
        ${clause}
        GROUP BY ec.id, ec.name, ec.kind ORDER BY total DESC`, params),
      db.query(`
        SELECT COALESCE(ec.kind, 'other') AS kind,
               COALESCE(SUM(e.amount), 0) AS total, COUNT(*) AS entries
        FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id
        ${clause}
        GROUP BY ec.kind ORDER BY total DESC`, params)
    ]);




    return { rows, totals, byCategory, byKind };
  },

  'expenses:get': async ({ id }) => db.one(`
    SELECT e.*, ec.name AS category_name FROM expenses e
    LEFT JOIN expense_categories ec ON ec.id = e.category_id WHERE e.id = ?`, [id]),

  'expenses:save': async (payload) => {
    const data = {
      category_id: payload.category_id ? Number(payload.category_id) : null,
      project_id: payload.project_id ? Number(payload.project_id) : null,
      title: str(payload.title, 220),
      payee: str(payload.payee, 180),
      amount: money(payload.amount),
      spent_on: dateOrNull(payload.spent_on) || today(),
      method: pick(payload.method, METHODS, 'upi'),
      reference: str(payload.reference, 120),
      notes: str(payload.notes)
    };
    if (!data.title) throw new Error('What was the expense for? A title is required.');
    if (data.amount <= 0) throw new Error('Enter an amount greater than zero.');

    if (payload.id) {
      await db.query(`
        UPDATE expenses SET category_id = ?, project_id = ?, title = ?, payee = ?,
          amount = ?, spent_on = ?, method = ?, reference = ?, notes = ?
        WHERE id = ?`,
        [data.category_id, data.project_id, data.title, data.payee, data.amount,
          data.spent_on, data.method, data.reference, data.notes, payload.id]);
      await logActivity(db, 'expense', payload.id, 'updated',
        `Expense updated: ${data.title} (₹${data.amount})`);
      return { id: Number(payload.id) };
    }

    const result = await db.query(`
      INSERT INTO expenses (category_id, project_id, title, payee, amount, spent_on,
        method, reference, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.category_id, data.project_id, data.title, data.payee, data.amount,
        data.spent_on, data.method, data.reference, data.notes]);
    await logActivity(db, 'expense', result.insertId, 'created',
      `Expense: ${data.title} (₹${data.amount})`);
    return { id: result.insertId };
  },

  'expenses:delete': async ({ id }) => {
    const row = await db.one('SELECT title, amount FROM expenses WHERE id = ?', [id]);
    await db.query('DELETE FROM expenses WHERE id = ?', [id]);
    await logActivity(db, 'expense', id, 'deleted',
      `Expense deleted: ${row ? row.title : id}`);
    return { id };
  },

  // -- recurring expenses, loans and EMIs ----------------------------------
  'expenses:recurringList': async ({ includeInactive } = {}) => db.query(`
    SELECT r.*, ec.name AS category_name, ec.kind AS category_kind,
      DATEDIFF(r.next_due_date, CURDATE()) AS days_to_due,
      (SELECT COUNT(*) FROM expenses e WHERE e.recurring_id = r.id) AS posted_count,
      (SELECT COALESCE(SUM(e.amount),0) FROM expenses e WHERE e.recurring_id = r.id) AS posted_total
    FROM recurring_expenses r
    LEFT JOIN expense_categories ec ON ec.id = r.category_id
    ${includeInactive ? '' : 'WHERE r.is_active = 1'}
    ORDER BY r.is_active DESC, r.next_due_date ASC`),

  'expenses:saveRecurring': async (payload) => {
    const data = {
      category_id: payload.category_id ? Number(payload.category_id) : null,
      title: str(payload.title, 220),
      payee: str(payload.payee, 180),
      amount: money(payload.amount),
      frequency: pick(payload.frequency, FREQUENCIES, 'monthly'),
      start_date: dateOrNull(payload.start_date) || today(),
      end_date: dateOrNull(payload.end_date),
      outstanding: payload.outstanding === '' || payload.outstanding === null ||
        payload.outstanding === undefined ? null : money(payload.outstanding),
      installments_left: payload.installments_left === '' ||
        payload.installments_left === null || payload.installments_left === undefined
        ? null : Math.max(0, Math.trunc(Number(payload.installments_left) || 0)),
      notes: str(payload.notes),
      is_active: payload.is_active === 0 ? 0 : 1
    };
    if (!data.title) throw new Error('Give this recurring payment a name.');
    if (data.amount <= 0) throw new Error('Enter an amount greater than zero.');
    const nextDue = dateOrNull(payload.next_due_date) || data.start_date;

    if (payload.id) {
      await db.query(`
        UPDATE recurring_expenses SET category_id = ?, title = ?, payee = ?, amount = ?,
          frequency = ?, start_date = ?, end_date = ?, next_due_date = ?,
          outstanding = ?, installments_left = ?, notes = ?, is_active = ?
        WHERE id = ?`,
        [data.category_id, data.title, data.payee, data.amount, data.frequency,
          data.start_date, data.end_date, nextDue, data.outstanding,
          data.installments_left, data.notes, data.is_active, payload.id]);
      return { id: Number(payload.id) };
    }

    const result = await db.query(`
      INSERT INTO recurring_expenses (category_id, title, payee, amount, frequency,
        start_date, end_date, next_due_date, outstanding, installments_left, notes, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.category_id, data.title, data.payee, data.amount, data.frequency,
        data.start_date, data.end_date, nextDue, data.outstanding,
        data.installments_left, data.notes, data.is_active]);
    await logActivity(db, 'recurring', result.insertId, 'created',
      `Recurring payment added: ${data.title} (₹${data.amount} ${data.frequency})`);
    return { id: result.insertId };
  },

  /**
   * Post one instalment of a recurring payment as a real expense, then roll the
   * schedule forward. Loan balances and remaining instalments come down too.
   */
  'expenses:postRecurring': async (payload) => db.tx(async (conn) => {
    const r = await conn.one('SELECT * FROM recurring_expenses WHERE id = ?', [payload.id]);
    if (!r) throw new Error('Recurring payment not found.');

    const amount = money(payload.amount !== undefined && payload.amount !== ''
      ? payload.amount : r.amount);
    const spentOn = dateOrNull(payload.spent_on) || r.next_due_date || today();

    const result = await conn.query(`
      INSERT INTO expenses (category_id, recurring_id, title, payee, amount, spent_on,
        method, reference, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.category_id, r.id, r.title, r.payee, amount, spentOn,
        pick(payload.method, METHODS, 'bank_transfer'), str(payload.reference, 120),
        str(payload.notes)]);

    const nextDue = advance(r.next_due_date || spentOn, r.frequency);
    const outstanding = r.outstanding === null ? null : money(Math.max(0, money(r.outstanding) - amount));
    const left = r.installments_left === null ? null : Math.max(0, r.installments_left - 1);
    // Close the schedule out once the last instalment or the end date is past.
    const stillActive = (left === 0 || (r.end_date && nextDue > r.end_date)) ? 0 : r.is_active;

    await conn.query(`
      UPDATE recurring_expenses SET next_due_date = ?, outstanding = ?,
        installments_left = ?, is_active = ? WHERE id = ?`,
      [nextDue, outstanding, left, stillActive, r.id]);

    await logActivity(conn, 'recurring', r.id, 'posted',
      `${r.title}: ₹${amount} paid on ${spentOn}`);
    return { id: r.id, expense_id: result.insertId, next_due_date: nextDue, outstanding, installments_left: left };
  }),

  'expenses:deleteRecurring': async ({ id }) => {
    await db.query('DELETE FROM recurring_expenses WHERE id = ?', [id]);
    return { id };
  },

  /** Recurring payments that are due now or overdue — the dashboard reminder. */
  'expenses:dueRecurring': async ({ withinDays } = {}) => {
    const days = Number.isFinite(Number(withinDays)) ? Number(withinDays) : 7;
    return db.query(`
      SELECT r.*, ec.name AS category_name,
             DATEDIFF(r.next_due_date, CURDATE()) AS days_to_due
      FROM recurring_expenses r
      LEFT JOIN expense_categories ec ON ec.id = r.category_id
      WHERE r.is_active = 1 AND r.next_due_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
      ORDER BY r.next_due_date ASC`, [days]);
  },

  'expenses:thisMonth': async () => {
    const { from, to } = monthRange(today());
    const row = await db.one(
      'SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS entries FROM expenses WHERE spent_on BETWEEN ? AND ?',
      [from, to]
    );
    return { from, to, ...row };
  },

  'expenses:monthly': async ({ months } = {}) => {
    const count = Math.min(Math.max(Number(months) || 12, 1), 36);
    return db.query(`
      SELECT DATE_FORMAT(spent_on, '%Y-%m') AS month,
             COALESCE(SUM(amount), 0) AS total, COUNT(*) AS entries
      FROM expenses
      WHERE spent_on >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL ? MONTH)
      GROUP BY month ORDER BY month ASC`, [count - 1]);
  }
};
