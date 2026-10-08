'use strict';

const db = require('../db');
const {
  str, money, dateOrNull, today, pick, monthRange, logActivity
} = require('../services/util');
const { syncProjectPayment } = require('../services/projectPayments');

const METHODS = ['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other'];

const CATEGORIES = [
  'Project work', 'Design work', 'Printing job', 'Retainer', 'Advance',
  'Reimbursement', 'Commission', 'Interest', 'Other'
];

function buildFilter({ search, clientId, projectId, source, category, method, from, to }) {
  const where = [];
  const params = [];
  if (search) {
    where.push('(i.description LIKE ? OR i.reference LIKE ? OR c.name LIKE ? OR p.title LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (clientId) { where.push('i.client_id = ?'); params.push(clientId); }
  if (projectId) { where.push('i.project_id = ?'); params.push(projectId); }
  if (source) { where.push('i.source = ?'); params.push(source); }
  if (category) { where.push('i.category = ?'); params.push(category); }
  if (method) { where.push('i.method = ?'); params.push(method); }
  if (from) { where.push('i.received_on >= ?'); params.push(from); }
  if (to) { where.push('i.received_on <= ?'); params.push(to); }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

module.exports = {
  'income:categories': async () => CATEGORIES,

  'income:list': async (filters = {}) => {
    const { clause, params } = buildFilter(filters);
    const rows = await db.query(`
      SELECT i.*, c.name AS client_name, c.company AS client_company,
             p.title AS project_title, inv.invoice_number
      FROM incomes i
      LEFT JOIN clients c  ON c.id = i.client_id
      LEFT JOIN projects p ON p.id = i.project_id
      LEFT JOIN invoices inv ON inv.id = i.invoice_id
      ${clause}
      ORDER BY i.received_on DESC, i.id DESC
      LIMIT 2000`, params);

    const totals = await db.one(`
      SELECT COALESCE(SUM(i.amount), 0) AS total, COUNT(*) AS entries
      FROM incomes i
      LEFT JOIN clients c  ON c.id = i.client_id
      LEFT JOIN projects p ON p.id = i.project_id
      ${clause}`, params);

    const byCategory = await db.query(`
      SELECT i.category, COALESCE(SUM(i.amount), 0) AS total, COUNT(*) AS entries
      FROM incomes i
      LEFT JOIN clients c  ON c.id = i.client_id
      LEFT JOIN projects p ON p.id = i.project_id
      ${clause}
      GROUP BY i.category ORDER BY total DESC`, params);

    const byClient = await db.query(`
      SELECT COALESCE(c.name, '(No client)') AS client_name,
             COALESCE(SUM(i.amount), 0) AS total, COUNT(*) AS entries
      FROM incomes i
      LEFT JOIN clients c  ON c.id = i.client_id
      LEFT JOIN projects p ON p.id = i.project_id
      ${clause}
      GROUP BY c.id, c.name ORDER BY total DESC LIMIT 15`, params);

    return { rows, totals, byCategory, byClient };
  },

  'income:get': async ({ id }) => db.one(`
    SELECT i.*, c.name AS client_name, p.title AS project_title
    FROM incomes i
    LEFT JOIN clients c ON c.id = i.client_id
    LEFT JOIN projects p ON p.id = i.project_id
    WHERE i.id = ?`, [id]),

  /**
   * Create or edit an income entry.
   *
   * Two shapes are allowed, exactly as agreed:
   *   - tied to a client (and optionally to one of that client's projects)
   *   - no client at all, in which case a description of how the money came in
   *     is required so no entry is ever left unexplained.
   */
  'income:save': async (payload) => db.tx(async (conn) => {
    const data = {
      client_id: payload.client_id ? Number(payload.client_id) : null,
      project_id: payload.project_id ? Number(payload.project_id) : null,
      amount: money(payload.amount),
      received_on: dateOrNull(payload.received_on) || today(),
      category: str(payload.category, 80) || 'Project work',
      description: str(payload.description, 500),
      method: pick(payload.method, METHODS, 'upi'),
      reference: str(payload.reference, 120)
    };
    if (data.amount <= 0) throw new Error('Enter an amount greater than zero.');
    if (!data.client_id && !data.description) {
      throw new Error('With no client selected, describe how this money came in.');
    }

    // A project always belongs to a client, so keep the two in step.
    if (data.project_id) {
      const project = await conn.one(
        'SELECT client_id FROM projects WHERE id = ?', [data.project_id]
      );
      if (!project) throw new Error('That project no longer exists.');
      if (!data.client_id) data.client_id = project.client_id;
    }

    const affected = new Set();
    let id = payload.id ? Number(payload.id) : null;

    if (id) {
      const existing = await conn.one(
        'SELECT project_id, source FROM incomes WHERE id = ?', [id]
      );
      if (!existing) throw new Error('Income entry not found.');
      if (existing.source === 'invoice') {
        throw new Error(
          'This entry was created by an invoice payment. Edit it from the ' +
          'invoice instead, so the invoice and the ledger stay in agreement.'
        );
      }
      if (existing.project_id) affected.add(existing.project_id);

      await conn.query(`
        UPDATE incomes SET client_id = ?, project_id = ?, amount = ?, received_on = ?,
          category = ?, description = ?, method = ?, reference = ?
        WHERE id = ?`,
        [data.client_id, data.project_id, data.amount, data.received_on,
          data.category, data.description, data.method, data.reference, id]);
      await logActivity(conn, 'income', id, 'updated',
        `Income updated: ₹${data.amount} on ${data.received_on}`);
    } else {
      const result = await conn.query(`
        INSERT INTO incomes (client_id, project_id, amount, received_on, category,
          description, method, reference, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')`,
        [data.client_id, data.project_id, data.amount, data.received_on,
          data.category, data.description, data.method, data.reference]);
      id = result.insertId;
      await logActivity(conn, 'income', id, 'created',
        `Income received: ₹${data.amount}${data.description ? ` — ${data.description}` : ''}`);
    }

    if (data.project_id) affected.add(data.project_id);
    for (const projectId of affected) await syncProjectPayment(conn, projectId);

    return { id };
  }),

  'income:delete': async ({ id }) => db.tx(async (conn) => {
    const entry = await conn.one(
      'SELECT amount, project_id, invoice_id, source FROM incomes WHERE id = ?', [id]
    );
    if (!entry) throw new Error('Income entry not found.');
    if (entry.source === 'invoice') {
      throw new Error(
        'This entry came from an invoice payment. Remove the payment from the ' +
        'invoice instead — that deletes this entry too.'
      );
    }
    await conn.query('DELETE FROM incomes WHERE id = ?', [id]);
    if (entry.project_id) await syncProjectPayment(conn, entry.project_id);
    await logActivity(conn, 'income', id, 'deleted', `Income entry deleted: ₹${entry.amount}`);
    return { id };
  }),

  /** Month-by-month totals for the Income tab's mini chart. */
  'income:monthly': async ({ months } = {}) => {
    const count = Math.min(Math.max(Number(months) || 12, 1), 36);
    return db.query(`
      SELECT DATE_FORMAT(received_on, '%Y-%m') AS month,
             COALESCE(SUM(amount), 0) AS total, COUNT(*) AS entries
      FROM incomes
      WHERE received_on >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL ? MONTH)
      GROUP BY month ORDER BY month ASC`, [count - 1]);
  },

  'income:thisMonth': async () => {
    const { from, to } = monthRange(today());
    const row = await db.one(
      'SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS entries FROM incomes WHERE received_on BETWEEN ? AND ?',
      [from, to]
    );
    return { from, to, ...row };
  }
};
