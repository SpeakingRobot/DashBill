'use strict';

const db = require('../db');
const {
  str, num, money, dateOrNull, today, pick, logActivity
} = require('../services/util');
const { syncProjectPayment } = require('../services/projectPayments');

const STATUSES = ['planned', 'in_progress', 'submitted', 'completed', 'on_hold', 'cancelled'];
const METHODS = ['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other'];

module.exports = {
  'projects:list': async ({ search, status, paymentStatus, clientId, from, to } = {}) => {
    const where = [];
    const params = [];
    if (search) {
      where.push('(p.title LIKE ? OR p.code LIKE ? OR p.description LIKE ? OR c.name LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    if (status && STATUSES.includes(status)) { where.push('p.status = ?'); params.push(status); }
    if (status === 'open') { where.push("p.status IN ('planned','in_progress','submitted','on_hold')"); }
    if (paymentStatus) { where.push('p.payment_status = ?'); params.push(paymentStatus); }
    if (clientId) { where.push('p.client_id = ?'); params.push(clientId); }
    if (from) { where.push('COALESCE(p.start_date, DATE(p.created_at)) >= ?'); params.push(from); }
    if (to) { where.push('COALESCE(p.start_date, DATE(p.created_at)) <= ?'); params.push(to); }

    return db.query(`
      SELECT p.*, c.name AS client_name, c.company AS client_company,
             (p.amount - p.amount_paid) AS balance,
             (SELECT COUNT(*) FROM invoices i WHERE i.project_id = p.id) AS invoice_count
      FROM projects p
      LEFT JOIN clients c ON c.id = p.client_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY FIELD(p.status,'in_progress','submitted','planned','on_hold','completed','cancelled'),
               COALESCE(p.due_date, '9999-12-31') ASC, p.id DESC`, params);
  },

  /** For the "pick a project" dropdown on the invoice and income forms. */
  'projects:options': async ({ clientId } = {}) => {
    const params = [];
    let where = "p.status <> 'cancelled'";
    if (clientId) { where += ' AND p.client_id = ?'; params.push(clientId); }
    return db.query(`
      SELECT p.id, p.title, p.amount, p.amount_paid, p.status, p.payment_status,
             p.client_id, c.name AS client_name
      FROM projects p LEFT JOIN clients c ON c.id = p.client_id
      WHERE ${where}
      ORDER BY p.id DESC`, params);
  },

  'projects:get': async ({ id }) => {
    const project = await db.one(`
      SELECT p.*, c.name AS client_name, c.company AS client_company
      FROM projects p LEFT JOIN clients c ON c.id = p.client_id
      WHERE p.id = ?`, [id]);
    if (!project) throw new Error('Project not found.');
    const payments = await db.query(
      `SELECT id, amount, received_on, method, reference, description, source
       FROM incomes WHERE project_id = ? ORDER BY received_on DESC, id DESC`, [id]
    );
    const invoices = await db.query(
      `SELECT id, invoice_number, invoice_date, total, amount_paid, status
       FROM invoices WHERE project_id = ? ORDER BY invoice_date DESC`, [id]
    );
    const expenses = await db.query(
      `SELECT e.id, e.title, e.amount, e.spent_on, ec.name AS category_name
       FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id
       WHERE e.project_id = ? ORDER BY e.spent_on DESC`, [id]
    );
    return { project, payments, invoices, expenses };
  },

  'projects:save': async (payload) => db.tx(async (conn) => {
    const data = {
      client_id: payload.client_id ? Number(payload.client_id) : null,
      code: str(payload.code, 40),
      title: str(payload.title, 220),
      description: str(payload.description),
      amount: money(payload.amount),
      status: pick(payload.status, STATUSES, 'planned'),
      start_date: dateOrNull(payload.start_date),
      due_date: dateOrNull(payload.due_date),
      notes: str(payload.notes)
    };
    if (!data.title) throw new Error('Project title is required.');
    if (data.amount < 0) throw new Error('Project amount cannot be negative.');

    // A project becomes "completed" the moment the status says so.
    const completedOn = data.status === 'completed'
      ? (dateOrNull(payload.completed_on) || today())
      : null;

    let id = payload.id ? Number(payload.id) : null;
    if (id) {
      await conn.query(`
        UPDATE projects SET client_id = ?, code = ?, title = ?, description = ?,
          amount = ?, status = ?, start_date = ?, due_date = ?,
          completed_on = CASE WHEN ? = 'completed' THEN COALESCE(completed_on, ?) ELSE NULL END,
          notes = ?
        WHERE id = ?`,
        [data.client_id, data.code, data.title, data.description, data.amount,
          data.status, data.start_date, data.due_date, data.status, completedOn,
          data.notes, id]);
      await logActivity(conn, 'project', id, 'updated', `Project updated: ${data.title}`);
    } else {
      const result = await conn.query(`
        INSERT INTO projects (client_id, code, title, description, amount, status,
          start_date, due_date, completed_on, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.client_id, data.code, data.title, data.description, data.amount,
          data.status, data.start_date, data.due_date, completedOn, data.notes]);
      id = result.insertId;
      await logActivity(conn, 'project', id, 'created',
        `New project: ${data.title} (₹${data.amount})`);
    }

    await syncProjectPayment(conn, id);
    return { id };
  }),

  /** Status changes get their own channel so the board can move cards quickly. */
  'projects:setStatus': async ({ id, status, completed_on }) => db.tx(async (conn) => {
    const next = pick(status, STATUSES, null);
    if (!next) throw new Error('Unknown project status.');
    const project = await conn.one('SELECT id, title, status FROM projects WHERE id = ?', [id]);
    if (!project) throw new Error('Project not found.');

    const completedOn = next === 'completed'
      ? (dateOrNull(completed_on) || today())
      : null;
    await conn.query(
      'UPDATE projects SET status = ?, completed_on = ? WHERE id = ?',
      [next, completedOn, id]
    );
    await logActivity(conn, 'project', id, next,
      `Project "${project.title}" marked ${next.replace('_', ' ')}`);
    return { id, status: next, completed_on: completedOn };
  }),

  /**
   * Record money received against a project. This writes an income row (so the
   * Income tab and the dashboard pick it up automatically) and then re-derives
   * the project's payment status from the ledger.
   */
  'projects:recordPayment': async (payload) => db.tx(async (conn) => {
    const project = await conn.one(
      'SELECT id, title, client_id, amount, amount_paid FROM projects WHERE id = ?',
      [payload.id]
    );
    if (!project) throw new Error('Project not found.');

    const balance = money(money(project.amount) - money(project.amount_paid));
    const amount = money(payload.amount !== undefined && payload.amount !== ''
      ? payload.amount
      : balance);
    if (amount <= 0) throw new Error('Enter a payment amount greater than zero.');

    const receivedOn = dateOrNull(payload.received_on) || today();
    const result = await conn.query(`
      INSERT INTO incomes (client_id, project_id, amount, received_on, category,
        description, method, reference, source)
      VALUES (?, ?, ?, ?, 'Project work', ?, ?, ?, 'project')`,
      [project.client_id, project.id, amount, receivedOn,
        str(payload.description, 500) || `Payment for project: ${project.title}`,
        pick(payload.method, METHODS, 'upi'), str(payload.reference, 120)]);

    const state = await syncProjectPayment(conn, project.id);
    await logActivity(conn, 'project', project.id, 'payment',
      `₹${amount} received for "${project.title}"`);
    return { id: project.id, income_id: result.insertId, ...state };
  }),

  /**
   * "Mark as paid" = settle the whole remaining balance in one go.
   * Deliberately gated on completion: the agreed workflow is complete the work
   * first, then confirm the client has paid. Part-payments and advances still
   * go through projects:recordPayment at any stage.
   */
  'projects:markPaid': async (payload) => db.tx(async (conn) => {
    const project = await conn.one(
      'SELECT id, title, client_id, amount, amount_paid, status FROM projects WHERE id = ?',
      [payload.id]
    );
    if (!project) throw new Error('Project not found.');
    if (project.status !== 'completed') {
      throw new Error(
        'Mark the project as Completed first, then mark it paid. ' +
        'For an advance or part payment use "Record payment" instead.'
      );
    }
    const balance = money(money(project.amount) - money(project.amount_paid));
    if (balance <= 0) throw new Error('This project is already fully paid.');

    const receivedOn = dateOrNull(payload.paid_on) || today();
    const result = await conn.query(`
      INSERT INTO incomes (client_id, project_id, amount, received_on, category,
        description, method, reference, source)
      VALUES (?, ?, ?, ?, 'Project work', ?, ?, ?, 'project')`,
      [project.client_id, project.id, balance, receivedOn,
        `Final payment for project: ${project.title}`,
        pick(payload.method, METHODS, 'upi'), str(payload.reference, 120)]);

    const state = await syncProjectPayment(conn, project.id);
    await logActivity(conn, 'project', project.id, 'paid',
      `Project "${project.title}" marked PAID (₹${balance})`);
    return { id: project.id, income_id: result.insertId, ...state };
  }),

  'projects:delete': async ({ id }) => db.tx(async (conn) => {
    const project = await conn.one('SELECT title FROM projects WHERE id = ?', [id]);
    const linked = num(await conn.scalar(
      'SELECT COUNT(*) FROM incomes WHERE project_id = ?', [id]
    ));
    if (linked > 0) {
      throw new Error(
        `This project has ${linked} income entr${linked === 1 ? 'y' : 'ies'} attached. ` +
        'Delete those entries first, or cancel the project instead of deleting it.'
      );
    }
    await conn.query('DELETE FROM projects WHERE id = ?', [id]);
    await logActivity(conn, 'project', id, 'deleted',
      `Project deleted: ${project ? project.title : id}`);
    return { id };
  })
};
