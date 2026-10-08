'use strict';

const db = require('../db');
const { today, monthRange, financialYear, money } = require('../services/util');

/** First day of the Indian financial year containing `dateStr`. */
function fyStart(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const year = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  return `${year}-04-01`;
}

async function sumIncome(from, to) {
  return money(await db.scalar(
    'SELECT COALESCE(SUM(amount), 0) FROM incomes WHERE received_on BETWEEN ? AND ?',
    [from, to]
  ));
}

async function sumExpenses(from, to) {
  return money(await db.scalar(
    'SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE spent_on BETWEEN ? AND ?',
    [from, to]
  ));
}

module.exports = {
  /** Cheap counters for the sidebar badges. Called after every navigation. */
  'dashboard:counts': async () => {
    const row = await db.one(`
      SELECT
        (SELECT COUNT(*) FROM projects
          WHERE status IN ('planned','in_progress','submitted','on_hold')) AS openProjects,
        (SELECT COUNT(*) FROM invoices
          WHERE status IN ('sent','partially_paid'))                       AS outstandingInvoices,
        (SELECT COUNT(*) FROM invoices
          WHERE status IN ('sent','partially_paid')
            AND due_date IS NOT NULL AND due_date < CURDATE())            AS overdueInvoices,
        (SELECT COUNT(*) FROM recurring_expenses
          WHERE is_active = 1 AND next_due_date <= CURDATE())             AS dueRecurring,
        (SELECT COUNT(*) FROM clients WHERE is_active = 1)                 AS clients`);
    return row || {};
  },

  /** Everything the dashboard needs, in one round trip. */
  'dashboard:summary': async ({ months } = {}) => {
    const now = today();
    const thisMonth = monthRange(now);

    const prevDate = new Date(`${thisMonth.from}T00:00:00`);
    prevDate.setMonth(prevDate.getMonth() - 1);
    const lastMonth = monthRange(
      `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-01`
    );

    const fyFrom = fyStart(now);

    const [
      monthIncome, monthExpense, prevIncome, prevExpense, fyIncome, fyExpense
    ] = await Promise.all([
      sumIncome(thisMonth.from, thisMonth.to),
      sumExpenses(thisMonth.from, thisMonth.to),
      sumIncome(lastMonth.from, lastMonth.to),
      sumExpenses(lastMonth.from, lastMonth.to),
      sumIncome(fyFrom, now),
      sumExpenses(fyFrom, now)
    ]);

    // Income vs expenses, month by month, for the dashboard chart.
    const window = Math.min(Math.max(Number(months) || 12, 3), 36);

    /*
     * Every figure below is independent of the others, so they all go to
     * the database at once rather than one after the next. Against a cloud
     * cluster that is the difference between one round trip and thirteen,
     * which was most of what made the dashboard feel slow.
     */
    const [
      clientCountRaw,
      receivables,
      projectStats,
      series,
      topClients,
      expenseByKind,
      dueRecurring,
      dueProjects,
      awaitingPayment,
      outstandingInvoices,
      activity,
      recentIncome,
      recentExpenses
    ] = await Promise.all([
      db.scalar('SELECT COUNT(*) FROM clients WHERE is_active = 1'),
      db.one(`
        SELECT COUNT(*) AS invoice_count,
               COALESCE(SUM(total - amount_paid), 0) AS outstanding,
               COALESCE(SUM(CASE WHEN due_date IS NOT NULL AND due_date < CURDATE()
                                 THEN total - amount_paid ELSE 0 END), 0) AS overdue,
               COALESCE(SUM(CASE WHEN due_date IS NOT NULL AND due_date < CURDATE()
                                 THEN 1 ELSE 0 END), 0) AS overdue_count
        FROM invoices WHERE status IN ('sent','partially_paid')`),
      db.one(`
        SELECT
          SUM(status IN ('planned','in_progress','submitted','on_hold')) AS open_count,
          SUM(status = 'in_progress')                                    AS in_progress,
          SUM(status = 'submitted')                                      AS submitted,
          SUM(status = 'completed' AND payment_status <> 'paid')          AS awaiting_payment,
          COALESCE(SUM(CASE WHEN status <> 'cancelled' AND payment_status <> 'paid'
                            THEN amount - amount_paid ELSE 0 END), 0)    AS unbilled_value,
          COALESCE(SUM(CASE WHEN due_date IS NOT NULL AND due_date < CURDATE()
                            AND status IN ('planned','in_progress','submitted','on_hold')
                            THEN 1 ELSE 0 END), 0)                       AS overdue_count
        FROM projects`),
      db.query(`
        SELECT m.month,
               COALESCE(i.total, 0) AS income,
               COALESCE(e.total, 0) AS expense
        FROM (
          SELECT DATE_FORMAT(received_on, '%Y-%m') AS month FROM incomes
          UNION
          SELECT DATE_FORMAT(spent_on, '%Y-%m') AS month FROM expenses
        ) m
        LEFT JOIN (
          SELECT DATE_FORMAT(received_on, '%Y-%m') AS month, SUM(amount) AS total
          FROM incomes GROUP BY month
        ) i ON i.month = m.month
        LEFT JOIN (
          SELECT DATE_FORMAT(spent_on, '%Y-%m') AS month, SUM(amount) AS total
          FROM expenses GROUP BY month
        ) e ON e.month = m.month
        WHERE m.month >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL ? MONTH), '%Y-%m')
        GROUP BY m.month, i.total, e.total
        ORDER BY m.month ASC`, [window - 1]),
      db.query(`
        SELECT c.id, c.name, c.company,
               COALESCE(SUM(i.amount), 0) AS total,
               COUNT(i.id) AS entries
        FROM clients c
        JOIN incomes i ON i.client_id = c.id AND i.received_on >= ?
        GROUP BY c.id, c.name, c.company
        ORDER BY total DESC LIMIT 6`, [fyFrom]),
      db.query(`
        SELECT COALESCE(ec.kind, 'other') AS kind, COALESCE(SUM(e.amount), 0) AS total
        FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id
        WHERE e.spent_on BETWEEN ? AND ?
        GROUP BY ec.kind ORDER BY total DESC`, [thisMonth.from, thisMonth.to]),
      db.query(`
        SELECT r.id, r.title, r.amount, r.next_due_date, r.frequency, r.outstanding,
               ec.name AS category_name,
               DATEDIFF(r.next_due_date, CURDATE()) AS days_to_due
        FROM recurring_expenses r
        LEFT JOIN expense_categories ec ON ec.id = r.category_id
        WHERE r.is_active = 1 AND r.next_due_date <= DATE_ADD(CURDATE(), INTERVAL 10 DAY)
        ORDER BY r.next_due_date ASC LIMIT 10`),
      db.query(`
        SELECT p.id, p.title, p.amount, p.due_date, p.status, p.payment_status,
               c.name AS client_name,
               DATEDIFF(p.due_date, CURDATE()) AS days_to_due
        FROM projects p LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.status IN ('planned','in_progress','submitted','on_hold')
          AND p.due_date IS NOT NULL
        ORDER BY p.due_date ASC LIMIT 10`),
      db.query(`
        SELECT p.id, p.title, p.amount, p.amount_paid, (p.amount - p.amount_paid) AS balance,
               p.completed_on, c.name AS client_name,
               (SELECT COUNT(*) FROM invoices iv WHERE iv.project_id = p.id) AS invoice_count
        FROM projects p LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.status = 'completed' AND p.payment_status <> 'paid'
        ORDER BY p.completed_on ASC LIMIT 10`),
      db.query(`
        SELECT i.id, i.invoice_number, i.invoice_date, i.due_date, i.total, i.amount_paid,
               (i.total - i.amount_paid) AS balance, i.status,
               COALESCE(c.name, i.bill_to_name) AS client_name,
               CASE WHEN i.due_date IS NOT NULL AND i.due_date < CURDATE()
                    THEN DATEDIFF(CURDATE(), i.due_date) ELSE 0 END AS days_overdue
        FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
        WHERE i.status IN ('sent','partially_paid')
        ORDER BY COALESCE(i.due_date, i.invoice_date) ASC LIMIT 8`),
      db.query(`
        SELECT entity, entity_id, action, summary, created_at
        FROM activity_log ORDER BY id DESC LIMIT 12`),
      db.query(`
        SELECT i.id, i.amount, i.received_on, i.description, i.category, i.source,
               c.name AS client_name, p.title AS project_title
        FROM incomes i
        LEFT JOIN clients c ON c.id = i.client_id
        LEFT JOIN projects p ON p.id = i.project_id
        ORDER BY i.received_on DESC, i.id DESC LIMIT 6`),
      db.query(`
        SELECT e.id, e.amount, e.spent_on, e.title, ec.name AS category_name
        FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id
        ORDER BY e.spent_on DESC, e.id DESC LIMIT 6`)
    ]);
    const clientCount = Number(clientCountRaw);

    return {
      asOf: now,
      financialYear: financialYear(now),
      periods: {
        month: { ...thisMonth, income: monthIncome, expense: monthExpense,
          net: money(monthIncome - monthExpense) },
        lastMonth: { ...lastMonth, income: prevIncome, expense: prevExpense,
          net: money(prevIncome - prevExpense) },
        financialYear: { from: fyFrom, to: now, income: fyIncome, expense: fyExpense,
          net: money(fyIncome - fyExpense) }
      },
      receivables,
      projectStats,
      clientCount,
      series,
      topClients,
      expenseByKind,
      dueRecurring,
      dueProjects,
      awaitingPayment,
      outstandingInvoices,
      activity,
      recentIncome,
      recentExpenses
    };
  },

  /**
   * Profit & loss style report for an arbitrary date range, used by the
   * Reports tab and when preparing figures for the accountant.
   */
  'dashboard:report': async ({ from, to } = {}) => {
    const start = from || fyStart(today());
    const end = to || today();

    // One round trip for the whole report rather than eight in a row.
    const [
      income,
      expense,
      incomeByCategory,
      incomeByClient,
      expenseByCategory,
      expenseByKind,
      monthly,
      gst
    ] = await Promise.all([
      sumIncome(start, end),
      sumExpenses(start, end),
      db.query(`
        SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS entries
        FROM incomes WHERE received_on BETWEEN ? AND ?
        GROUP BY category ORDER BY total DESC`, [start, end]),
      db.query(`
        SELECT COALESCE(c.name, '(No client)') AS client_name,
               COALESCE(SUM(i.amount), 0) AS total, COUNT(*) AS entries
        FROM incomes i LEFT JOIN clients c ON c.id = i.client_id
        WHERE i.received_on BETWEEN ? AND ?
        GROUP BY c.id, c.name ORDER BY total DESC`, [start, end]),
      db.query(`
        SELECT COALESCE(ec.name, '(Uncategorised)') AS category_name,
               COALESCE(ec.kind, 'other') AS kind,
               COALESCE(SUM(e.amount), 0) AS total, COUNT(*) AS entries
        FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id
        WHERE e.spent_on BETWEEN ? AND ?
        GROUP BY ec.id, ec.name, ec.kind ORDER BY total DESC`, [start, end]),
      db.query(`
        SELECT COALESCE(ec.kind, 'other') AS kind,
               COALESCE(SUM(e.amount), 0) AS total, COUNT(*) AS entries
        FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id
        WHERE e.spent_on BETWEEN ? AND ?
        GROUP BY ec.kind ORDER BY total DESC`, [start, end]),
      db.query(`
        SELECT m.month, COALESCE(i.total, 0) AS income, COALESCE(e.total, 0) AS expense
        FROM (
          SELECT DATE_FORMAT(received_on, '%Y-%m') AS month FROM incomes
          WHERE received_on BETWEEN ? AND ?
          UNION
          SELECT DATE_FORMAT(spent_on, '%Y-%m') AS month FROM expenses
          WHERE spent_on BETWEEN ? AND ?
        ) m
        LEFT JOIN (
          SELECT DATE_FORMAT(received_on, '%Y-%m') AS month, SUM(amount) AS total
          FROM incomes WHERE received_on BETWEEN ? AND ? GROUP BY month
        ) i ON i.month = m.month
        LEFT JOIN (
          SELECT DATE_FORMAT(spent_on, '%Y-%m') AS month, SUM(amount) AS total
          FROM expenses WHERE spent_on BETWEEN ? AND ? GROUP BY month
        ) e ON e.month = m.month
        GROUP BY m.month, i.total, e.total ORDER BY m.month ASC`,
        [start, end, start, end, start, end, start, end]),
      db.one(`
        SELECT COALESCE(SUM(taxable_amount), 0) AS taxable,
               COALESCE(SUM(gst_amount), 0) AS gst,
               COALESCE(SUM(cgst_amount), 0) AS cgst,
               COALESCE(SUM(sgst_amount), 0) AS sgst,
               COALESCE(SUM(igst_amount), 0) AS igst,
               COALESCE(SUM(total), 0) AS billed,
               COUNT(*) AS invoice_count
        FROM invoices
        WHERE status <> 'cancelled' AND invoice_date BETWEEN ? AND ?`, [start, end])
    ]);

    return {
      from: start,
      to: end,
      income: money(income),
      expense: money(expense),
      net: money(money(income) - money(expense)),
      incomeByCategory,
      incomeByClient,
      expenseByCategory,
      expenseByKind,
      monthly,
      gst
    };
  }
};
