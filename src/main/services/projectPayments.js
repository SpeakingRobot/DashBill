'use strict';

const { money } = require('./util');

/**
 * Recalculate a project's payment state from the income rows attached to it,
 * then write it back.
 *
 * This is the single source of truth: whether money arrived through "Record
 * payment" on the project, through an invoice payment, or through a manual
 * income entry tagged to the project, the project always agrees with the income
 * ledger. Every module that inserts, edits or deletes an income row with a
 * project_id calls this afterwards.
 *
 * `conn` is a transaction helper from db.tx (or the db module itself).
 */
async function syncProjectPayment(conn, projectId) {
  if (!projectId) return null;

  const project = await conn.one(
    'SELECT id, amount FROM projects WHERE id = ?', [projectId]
  );
  if (!project) return null;

  const paid = money(await conn.scalar(
    'SELECT COALESCE(SUM(amount), 0) FROM incomes WHERE project_id = ?', [projectId]
  ));
  const amount = money(project.amount);

  // A tolerance of under a paisa keeps rounding from leaving a project
  // permanently "partial" when it is in fact settled.
  let status = 'unpaid';
  if (paid > 0 && paid + 0.009 < amount) status = 'partial';
  else if (paid > 0 && paid + 0.009 >= amount) status = 'paid';

  const paidOn = status === 'paid'
    ? await conn.scalar('SELECT MAX(received_on) FROM incomes WHERE project_id = ?', [projectId])
    : null;

  await conn.query(
    'UPDATE projects SET amount_paid = ?, payment_status = ?, paid_on = ? WHERE id = ?',
    [paid, status, paidOn, projectId]
  );
  return { amount_paid: paid, payment_status: status, paid_on: paidOn };
}

module.exports = { syncProjectPayment };
