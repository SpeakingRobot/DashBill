'use strict';

const db = require('../db');
const { str, logActivity } = require('../services/util');

const COLUMNS = [
  'name', 'company', 'email', 'phone', 'gstin', 'pan',
  'address_line1', 'address_line2', 'city', 'state', 'pincode', 'country', 'notes'
];

function sanitise(payload) {
  return {
    name: str(payload.name, 180),
    company: str(payload.company, 180),
    email: str(payload.email, 180),
    phone: str(payload.phone, 60),
    gstin: str(payload.gstin, 20) ? str(payload.gstin, 20).toUpperCase() : null,
    pan: str(payload.pan, 20) ? str(payload.pan, 20).toUpperCase() : null,
    address_line1: str(payload.address_line1, 255),
    address_line2: str(payload.address_line2, 255),
    city: str(payload.city, 120),
    state: str(payload.state, 120),
    pincode: str(payload.pincode, 20),
    country: str(payload.country, 120) || 'India',
    notes: str(payload.notes)
  };
}

module.exports = {
  /** Full list with per-client business totals, for the Clients table. */
  'clients:list': async ({ search, includeInactive } = {}) => {
    const where = [];
    const params = [];
    if (!includeInactive) where.push('c.is_active = 1');
    if (search) {
      where.push('(c.name LIKE ? OR c.company LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    const sql = `
      SELECT c.*,
        COALESCE(inc.total_received, 0)        AS total_received,
        COALESCE(pr.project_count, 0)          AS project_count,
        COALESCE(pr.project_value, 0)          AS project_value,
        COALESCE(inv.outstanding, 0)           AS outstanding,
        inc.last_payment_on
      FROM clients c
      LEFT JOIN (
        SELECT client_id, SUM(amount) AS total_received, MAX(received_on) AS last_payment_on
        FROM incomes WHERE client_id IS NOT NULL GROUP BY client_id
      ) inc ON inc.client_id = c.id
      LEFT JOIN (
        SELECT client_id, COUNT(*) AS project_count, SUM(amount) AS project_value
        FROM projects WHERE client_id IS NOT NULL GROUP BY client_id
      ) pr ON pr.client_id = c.id
      LEFT JOIN (
        SELECT client_id, SUM(total - amount_paid) AS outstanding
        FROM invoices
        WHERE client_id IS NOT NULL AND status IN ('sent','partially_paid')
        GROUP BY client_id
      ) inv ON inv.client_id = c.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY c.name ASC`;
    return db.query(sql, params);
  },

  /** Lightweight list for the "existing clients" dropdowns. */
  'clients:options': async () => db.query(
    `SELECT id, name, company, gstin, state
     FROM clients WHERE is_active = 1 ORDER BY name ASC`
  ),

  'clients:get': async ({ id }) => {
    const client = await db.one('SELECT * FROM clients WHERE id = ?', [id]);
    if (!client) throw new Error('Client not found.');
    const projects = await db.query(
      `SELECT id, title, amount, status, payment_status, due_date, completed_on
       FROM projects WHERE client_id = ? ORDER BY COALESCE(due_date, created_at) DESC`,
      [id]
    );
    const incomes = await db.query(
      `SELECT id, amount, received_on, category, description, method, source
       FROM incomes WHERE client_id = ? ORDER BY received_on DESC LIMIT 100`,
      [id]
    );
    const invoices = await db.query(
      `SELECT id, invoice_number, invoice_date, total, amount_paid, status
       FROM invoices WHERE client_id = ? ORDER BY invoice_date DESC LIMIT 100`,
      [id]
    );
    return { client, projects, incomes, invoices };
  },

  'clients:save': async (payload) => {
    const data = sanitise(payload);
    if (!data.name) throw new Error('Client name is required.');

    if (payload.id) {
      await db.query(
        `UPDATE clients SET ${COLUMNS.map((c) => `${c} = ?`).join(', ')},
         is_active = ? WHERE id = ?`,
        [...COLUMNS.map((c) => data[c]), payload.is_active === 0 ? 0 : 1, payload.id]
      );
      await logActivity(db, 'client', payload.id, 'updated', `Client updated: ${data.name}`);
      return { id: Number(payload.id) };
    }

    const result = await db.query(
      `INSERT INTO clients (${COLUMNS.join(', ')})
       VALUES (${COLUMNS.map(() => '?').join(', ')})`,
      COLUMNS.map((c) => data[c])
    );
    await logActivity(db, 'client', result.insertId, 'created', `New client: ${data.name}`);
    return { id: result.insertId };
  },

  'clients:setActive': async ({ id, active }) => {
    await db.query('UPDATE clients SET is_active = ? WHERE id = ?', [active ? 1 : 0, id]);
    return { id };
  },

  /**
   * Hard delete. Projects/incomes/invoices keep their rows but lose the link
   * (ON DELETE SET NULL), so historical money totals never change.
   */
  'clients:delete': async ({ id }) => {
    const client = await db.one('SELECT name FROM clients WHERE id = ?', [id]);
    await db.query('DELETE FROM clients WHERE id = ?', [id]);
    await logActivity(db, 'client', id, 'deleted',
      `Client deleted: ${client ? client.name : id}`);
    return { id };
  }
};
