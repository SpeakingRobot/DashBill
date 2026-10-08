'use strict';

const path = require('path');
const { dialog, shell, BrowserWindow } = require('electron');

const db = require('../db');
const {
  str, num, money, dateOrNull, today, addDays, pick, readSettings, logActivity
} = require('../services/util');
const { computeInvoice, paymentStatus } = require('../services/invoiceMath');
const { peekNextNumber, consumeNextNumber } = require('../services/numbering');
const { renderInvoiceHtml } = require('../services/invoiceTemplate');
const {
  htmlToPdfFile, safeFileName, writeTempHtml, removeTemp
} = require('../services/pdf');
const { syncProjectPayment } = require('../services/projectPayments');

const STATUSES = ['draft', 'sent', 'partially_paid', 'paid', 'cancelled'];
const METHODS = ['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other'];

/** Freeze a client's current address onto the invoice as a text block. */
function clientAddressBlock(client) {
  if (!client) return null;
  const lines = [
    client.company && client.company !== client.name ? client.company : null,
    client.address_line1,
    client.address_line2,
    [client.city, client.state, client.pincode].filter(Boolean).join(', ') || null,
    client.country && client.country !== 'India' ? client.country : null,
    client.phone ? `Phone: ${client.phone}` : null,
    client.email || null
  ].filter(Boolean);
  return lines.length ? lines.join('\n') : null;
}

/**
 * The payment details from Settings, rendered as editable text so an invoice
 * can carry different bank details without changing the company profile.
 */
function defaultBankBlock(settings) {
  return [
    ['Account Name', settings.bank_account_name],
    ['Bank', settings.bank_name],
    ['Account No.', settings.bank_account_number],
    ['IFSC', settings.bank_ifsc],
    ['Branch', settings.bank_branch],
    ['UPI', settings.bank_upi]
  ].filter((pair) => pair[1] && String(pair[1]).trim())
    .map((pair) => `${pair[0]}: ${String(pair[1]).trim()}`)
    .join('\n');
}

function companyAddressBlock(settings) {
  const lines = [
    settings.company_address_line1,
    settings.company_address_line2,
    [settings.company_city, settings.company_state, settings.company_pincode]
      .filter(Boolean).join(', ') || null,
    settings.company_country || null
  ].filter(Boolean);
  return lines.length ? lines.join('\n') : null;
}

/** Load an invoice with its items and payments. */
async function loadInvoice(conn, id) {
  const invoice = await conn.one(`
    SELECT i.*, c.name AS client_name, c.company AS client_company,
           c.email AS client_email, c.phone AS client_phone,
           p.title AS project_title
    FROM invoices i
    LEFT JOIN clients c  ON c.id = i.client_id
    LEFT JOIN projects p ON p.id = i.project_id
    WHERE i.id = ?`, [id]);
  if (!invoice) throw new Error('Invoice not found.');

  const items = await conn.query(
    'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position ASC, id ASC', [id]
  );
  const payments = await conn.query(
    'SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_on ASC, id ASC', [id]
  );
  return { invoice, items, payments };
}

/** Re-derive amount_paid and status from the payment rows. */
async function syncInvoicePayments(conn, invoiceId) {
  const invoice = await conn.one(
    'SELECT id, total, status, project_id FROM invoices WHERE id = ?', [invoiceId]
  );
  if (!invoice) return null;
  const paid = money(await conn.scalar(
    'SELECT COALESCE(SUM(amount), 0) FROM invoice_payments WHERE invoice_id = ?', [invoiceId]
  ));
  const status = paymentStatus(invoice.total, paid, invoice.status);
  await conn.query('UPDATE invoices SET amount_paid = ?, status = ? WHERE id = ?',
    [paid, status, invoiceId]);
  if (invoice.project_id) await syncProjectPayment(conn, invoice.project_id);
  return { amount_paid: paid, status };
}

/** Build the full HTML document for an invoice id. */
async function buildHtml(id, { screen = false } = {}) {
  const { invoice, items, payments } = await loadInvoice(db, id);
  const settings = await readSettings(db);
  return renderInvoiceHtml({
    invoice, items, payments, settings, screen, projectTitle: invoice.project_title
  });
}

module.exports = {
  'invoices:list': async (filters = {}) => {
    const where = [];
    const params = [];
    if (filters.search) {
      where.push('(i.invoice_number LIKE ? OR i.bill_to_name LIKE ? OR c.name LIKE ? OR p.title LIKE ?)');
      const like = `%${filters.search}%`;
      params.push(like, like, like, like);
    }
    if (filters.status && STATUSES.includes(filters.status)) {
      where.push('i.status = ?'); params.push(filters.status);
    }
    if (filters.status === 'outstanding') {
      where.push("i.status IN ('sent','partially_paid')");
    }
    if (filters.status === 'overdue') {
      where.push("i.status IN ('sent','partially_paid') AND i.due_date IS NOT NULL AND i.due_date < CURDATE()");
    }
    if (filters.clientId) { where.push('i.client_id = ?'); params.push(filters.clientId); }
    if (filters.projectId) { where.push('i.project_id = ?'); params.push(filters.projectId); }
    if (filters.from) { where.push('i.invoice_date >= ?'); params.push(filters.from); }
    if (filters.to) { where.push('i.invoice_date <= ?'); params.push(filters.to); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await db.query(`
      SELECT i.*, c.name AS client_name, p.title AS project_title,
             (i.total - i.amount_paid) AS balance,
             CASE WHEN i.status IN ('sent','partially_paid') AND i.due_date IS NOT NULL
                    AND i.due_date < CURDATE()
                  THEN DATEDIFF(CURDATE(), i.due_date) ELSE 0 END AS days_overdue,
             (SELECT COUNT(*) FROM invoice_items it WHERE it.invoice_id = i.id) AS item_count
      FROM invoices i
      LEFT JOIN clients c  ON c.id = i.client_id
      LEFT JOIN projects p ON p.id = i.project_id
      ${clause}
      ORDER BY i.invoice_date DESC, i.id DESC
      LIMIT 2000`, params);

    const totals = await db.one(`
      SELECT COUNT(*) AS count,
             COALESCE(SUM(i.total), 0) AS billed,
             COALESCE(SUM(i.amount_paid), 0) AS received,
             COALESCE(SUM(CASE WHEN i.status IN ('sent','partially_paid')
                               THEN i.total - i.amount_paid ELSE 0 END), 0) AS outstanding,
             COALESCE(SUM(i.gst_amount + i.cgst_amount + i.sgst_amount + i.igst_amount), 0) AS gst_collected
      FROM invoices i
      LEFT JOIN clients c  ON c.id = i.client_id
      LEFT JOIN projects p ON p.id = i.project_id
      ${clause}`, params);

    return { rows, totals };
  },

  'invoices:get': async ({ id, withOptions }) => {
    // The edit dialog wants the dropdown lists as well; the viewer does not.
    const [loaded, settings, clients, projects] = await Promise.all([
      loadInvoice(db, id),
      readSettings(db),
      withOptions
        ? db.query(`SELECT id, name, company, gstin, state
                    FROM clients WHERE is_active = 1 ORDER BY name ASC`)
        : Promise.resolve(null),
      withOptions
        ? db.query(`
            SELECT p.id, p.title, p.amount, p.amount_paid, p.status, p.payment_status,
                   p.client_id, c.name AS client_name
            FROM projects p LEFT JOIN clients c ON c.id = p.client_id
            WHERE p.status <> 'cancelled' ORDER BY p.id DESC`)
        : Promise.resolve(null)
    ]);
    return Object.assign(loaded, {
      defaultBankDetails: defaultBankBlock(settings),
      clients,
      projects
    });
  },

  /**
   * Prefill a new invoice. Pass a projectId to auto-bill that project: the
   * project becomes the first line item, and any expenses booked against the
   * project can be pulled in as extra lines.
   */
  'invoices:newDraft': async ({ clientId, projectId, includeProjectExpenses } = {}) => {
    const invoiceDate = today();

    /*
     * Everything the editor needs, in as few round trips as possible.
     *
     * This runs the moment "New invoice" is pressed, so its cost is what the
     * user experiences as the dialog being slow to appear. The settings, the
     * next invoice number, the project and the dropdown lists do not depend on
     * one another, so they are fetched together; only the client lookup has to
     * wait, because a project supplies the client when one was not named.
     */
    const [settings, numbering, project, clientOptions] = await Promise.all([
      readSettings(db),
      peekNextNumber(db, invoiceDate),
      projectId
        ? db.one('SELECT * FROM projects WHERE id = ?', [projectId])
        : Promise.resolve(null),
      db.query(`SELECT id, name, company, gstin, state
                FROM clients WHERE is_active = 1 ORDER BY name ASC`)
    ]);
    const number = numbering.number;

    if (project && project.client_id) clientId = project.client_id;

    const [client, projectOptions] = await Promise.all([
      clientId
        ? db.one('SELECT * FROM clients WHERE id = ?', [clientId])
        : Promise.resolve(null),
      db.query(`
        SELECT p.id, p.title, p.amount, p.amount_paid, p.status, p.payment_status,
               p.client_id, c.name AS client_name
        FROM projects p LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.status <> 'cancelled'
          ${clientId ? 'AND p.client_id = ?' : ''}
        ORDER BY p.id DESC`, clientId ? [clientId] : [])
    ]);

    /*
     * Decide the GST treatment for the draft.
     *
     * Whether GST applies at all follows from registration: a business with a
     * GSTIN on its profile has to charge it, one without must not. The default
     * shape is a single combined "GST @ 18%" line, which is what standard
     * commercial work wants. Only if the default in Settings is one of the
     * split forms does the client's state decide between CGST+SGST and IGST.
     * Either way it is a starting point the invoice form can override.
     */
    const registered = Boolean(String(settings.company_gstin || '').trim());
    const companyState = (settings.company_state || '').trim().toLowerCase();
    const clientState = (client && client.state ? client.state : '').trim().toLowerCase();

    let gstMode = settings.invoice_default_gst_mode || 'gst';
    if (!registered) {
      gstMode = 'none';
    } else {
      if (gstMode === 'none') gstMode = 'gst';
      if (gstMode !== 'gst' && companyState && clientState) {
        gstMode = companyState === clientState ? 'cgst_sgst' : 'igst';
      }
    }

    const items = [];
    if (project) {
      items.push({
        description: project.title + (project.description ? `\n${project.description}` : ''),
        hsn_sac: '',
        quantity: 1,
        unit: 'job',
        rate: money(project.amount)
      });

      if (includeProjectExpenses) {
        const expenses = await db.query(
          `SELECT title, amount FROM expenses WHERE project_id = ? ORDER BY spent_on ASC`,
          [projectId]
        );
        for (const expense of expenses) {
          items.push({
            description: `Reimbursable: ${expense.title}`,
            hsn_sac: '', quantity: 1, unit: '', rate: money(expense.amount)
          });
        }
      }
    }
    if (!items.length) {
      items.push({ description: '', hsn_sac: '', quantity: 1, unit: '', rate: 0 });
    }

    const dueDays = parseInt(settings.invoice_default_due_days, 10);

    return {
      invoice: {
        id: null,
        invoice_number: number,
        client_id: client ? client.id : null,
        project_id: project ? project.id : null,
        invoice_date: invoiceDate,
        due_date: Number.isFinite(dueDays) ? addDays(invoiceDate, dueDays) : null,
        status: 'draft',
        bill_to_name: client ? (client.company || client.name) : '',
        bill_to_address: clientAddressBlock(client),
        bill_to_gstin: client ? client.gstin : null,
        bill_from_name: settings.company_name || null,
        bill_from_address: companyAddressBlock(settings),
        bill_from_gstin: settings.company_gstin || null,
        place_of_supply: (client && client.state) || settings.company_state || null,
        currency_symbol: settings.currency_symbol || '₹',
        gst_mode: gstMode,
        gst_rate: gstMode === 'none' ? 0 : num(settings.invoice_default_gst_rate, 18),
        discount_type: 'none',
        discount_value: 0,
        shipping_amount: 0,
        round_off_enabled: settings.invoice_round_off !== '0',
        notes: null,
        terms: settings.invoice_default_terms || null,
        bank_details: null,
        // Description, quantity, rate and amount only. HSN/SAC and Unit stay
        // off unless this invoice actually needs them, so the printed bill
        // never carries an empty column.
        column_config: { quantity: true, hsn: false, unit: false, custom: [] },
        amount_paid: 0
      },
      items,
      client,
      project,
      // The editor used to fetch these separately, which meant a second trip
      // to the database before the dialog could be drawn.
      clients: clientOptions,
      projects: projectOptions,
      // Shown in the editor so the payment details can be adjusted per invoice.
      defaultBankDetails: defaultBankBlock(settings)
    };
  },

  'invoices:nextNumber': async ({ invoice_date } = {}) => {
    const { number } = await peekNextNumber(db, dateOrNull(invoice_date) || today());
    return { number };
  },

  /** Create or replace an invoice together with all of its line items. */
  'invoices:save': async (payload) => db.tx(async (conn) => {
    const computed = computeInvoice({
      items: payload.items,
      columns: payload.columns,
      discount_type: payload.discount_type,
      discount_value: payload.discount_value,
      gst_mode: payload.gst_mode,
      gst_rate: payload.gst_rate,
      shipping_amount: payload.shipping_amount,
      round_off_enabled: payload.round_off_enabled
    });
    if (!computed.items.length) {
      throw new Error('Add at least one line item with a description.');
    }

    const invoiceDate = dateOrNull(payload.invoice_date) || today();
    const id = payload.id ? Number(payload.id) : null;

    // A hand-typed number wins; otherwise take the next one from the counter.
    let invoiceNumber = str(payload.invoice_number, 60);
    if (!id && !invoiceNumber) invoiceNumber = await consumeNextNumber(conn, invoiceDate);
    if (!invoiceNumber) throw new Error('An invoice number is required.');

    const clientId = payload.client_id ? Number(payload.client_id) : null;
    const projectId = payload.project_id ? Number(payload.project_id) : null;

    let billToName = str(payload.bill_to_name, 220);
    let billToAddress = str(payload.bill_to_address);
    let billToGstin = str(payload.bill_to_gstin, 20);
    if (clientId && (!billToName || !billToAddress)) {
      const client = await conn.one('SELECT * FROM clients WHERE id = ?', [clientId]);
      if (client) {
        billToName = billToName || client.company || client.name;
        billToAddress = billToAddress || clientAddressBlock(client);
        billToGstin = billToGstin || client.gstin;
      }
    }
    if (!billToName) throw new Error('Who is this invoice for? Enter a billing name.');

    const fields = {
      invoice_number: invoiceNumber,
      client_id: clientId,
      project_id: projectId,
      invoice_date: invoiceDate,
      due_date: dateOrNull(payload.due_date),
      bill_to_name: billToName,
      bill_to_address: billToAddress,
      bill_to_gstin: billToGstin ? billToGstin.toUpperCase() : null,
      bill_from_name: str(payload.bill_from_name, 220),
      bill_from_address: str(payload.bill_from_address),
      bill_from_gstin: str(payload.bill_from_gstin, 20),
      place_of_supply: str(payload.place_of_supply, 120),
      currency_symbol: str(payload.currency_symbol, 8) || '₹',
      gst_mode: computed.gst_mode,
      gst_rate: computed.gst_rate,
      gst_amount: computed.gst_amount,
      subtotal: computed.subtotal,
      discount_type: computed.discount_type,
      discount_value: computed.discount_value,
      discount_amount: computed.discount_amount,
      taxable_amount: computed.taxable_amount,
      cgst_amount: computed.cgst_amount,
      sgst_amount: computed.sgst_amount,
      igst_amount: computed.igst_amount,
      shipping_amount: computed.shipping_amount,
      round_off: computed.round_off,
      total: computed.total,
      notes: str(payload.notes),
      terms: str(payload.terms),
      bank_details: str(payload.bank_details),
      column_config: JSON.stringify(computed.columns)
    };

    let invoiceId = id;
    if (invoiceId) {
      const existing = await conn.one('SELECT status FROM invoices WHERE id = ?', [invoiceId]);
      if (!existing) throw new Error('Invoice not found.');
      const keys = Object.keys(fields);
      await conn.query(
        `UPDATE invoices SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
        [...keys.map((k) => fields[k]), invoiceId]
      );
      await conn.query('DELETE FROM invoice_items WHERE invoice_id = ?', [invoiceId]);
      await logActivity(conn, 'invoice', invoiceId, 'updated',
        `Invoice ${invoiceNumber} updated (₹${computed.total})`);
    } else {
      const keys = Object.keys(fields);
      const result = await conn.query(
        `INSERT INTO invoices (${keys.join(', ')}, status)
         VALUES (${keys.map(() => '?').join(', ')}, ?)`,
        [...keys.map((k) => fields[k]), pick(payload.status, STATUSES, 'draft')]
      );
      invoiceId = result.insertId;
      await logActivity(conn, 'invoice', invoiceId, 'created',
        `Invoice ${invoiceNumber} created for ${billToName} (₹${computed.total})`);
    }

    const itemRows = computed.items.map((item) => [
      invoiceId, item.position, item.description, item.hsn_sac,
      item.quantity, item.unit, item.rate, item.amount,
      Object.keys(item.custom_fields).length ? JSON.stringify(item.custom_fields) : null
    ]);
    await conn.raw(
      `INSERT INTO invoice_items
       (invoice_id, position, description, hsn_sac, quantity, unit, rate, amount,
        custom_fields)
       VALUES ?`, [itemRows]
    );

    await syncInvoicePayments(conn, invoiceId);
    return { id: invoiceId, invoice_number: invoiceNumber, total: computed.total };
  }),

  'invoices:setStatus': async ({ id, status }) => db.tx(async (conn) => {
    const next = pick(status, STATUSES, null);
    if (!next) throw new Error('Unknown invoice status.');
    const invoice = await conn.one(
      'SELECT invoice_number, total, amount_paid FROM invoices WHERE id = ?', [id]
    );
    if (!invoice) throw new Error('Invoice not found.');

    if (next === 'paid' && money(invoice.amount_paid) + 0.009 < money(invoice.total)) {
      throw new Error(
        'Record the payment instead — use "Record payment" so the money also ' +
        'lands in your Income ledger.'
      );
    }
    await conn.query('UPDATE invoices SET status = ? WHERE id = ?', [next, id]);
    await logActivity(conn, 'invoice', id, next,
      `Invoice ${invoice.invoice_number} marked ${next.replace('_', ' ')}`);
    return { id, status: next };
  }),

  /**
   * Record a payment against an invoice. This also writes the matching income
   * entry (source = invoice) and, if the invoice is tied to a project, updates
   * that project's payment status — one action, every ledger in agreement.
   */
  'invoices:recordPayment': async (payload) => db.tx(async (conn) => {
    const invoice = await conn.one(
      `SELECT id, invoice_number, client_id, project_id, total, amount_paid, status
       FROM invoices WHERE id = ?`, [payload.invoice_id || payload.id]
    );
    if (!invoice) throw new Error('Invoice not found.');
    if (invoice.status === 'cancelled') {
      throw new Error('This invoice is cancelled. Reopen it before recording a payment.');
    }

    const balance = money(money(invoice.total) - money(invoice.amount_paid));
    const amount = money(payload.amount !== undefined && payload.amount !== ''
      ? payload.amount : balance);
    if (amount <= 0) throw new Error('Enter a payment amount greater than zero.');
    if (amount > balance + 0.009 && !payload.allowOverpay) {
      throw new Error(
        `That is more than the balance due (₹${balance.toFixed(2)}). ` +
        'Adjust the amount, or tick "allow overpayment".'
      );
    }

    const paidOn = dateOrNull(payload.paid_on) || today();
    const method = pick(payload.method, METHODS, 'upi');
    const reference = str(payload.reference, 120);

    const income = await conn.query(`
      INSERT INTO incomes (client_id, project_id, invoice_id, amount, received_on,
        category, description, method, reference, source)
      VALUES (?, ?, ?, ?, ?, 'Project work', ?, ?, ?, 'invoice')`,
      [invoice.client_id, invoice.project_id, invoice.id, amount, paidOn,
        `Payment against invoice ${invoice.invoice_number}`, method, reference]);

    const payment = await conn.query(`
      INSERT INTO invoice_payments (invoice_id, income_id, amount, paid_on, method,
        reference, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [invoice.id, income.insertId, amount, paidOn, method, reference,
        str(payload.notes, 400)]);

    const state = await syncInvoicePayments(conn, invoice.id);
    await logActivity(conn, 'invoice', invoice.id, 'payment',
      `₹${amount} received against invoice ${invoice.invoice_number}`);
    return { id: invoice.id, payment_id: payment.insertId, income_id: income.insertId, ...state };
  }),

  /** Removing a payment removes the income entry it created, too. */
  'invoices:deletePayment': async ({ id }) => db.tx(async (conn) => {
    const payment = await conn.one(
      'SELECT invoice_id, income_id, amount FROM invoice_payments WHERE id = ?', [id]
    );
    if (!payment) throw new Error('Payment not found.');
    await conn.query('DELETE FROM invoice_payments WHERE id = ?', [id]);
    if (payment.income_id) {
      await conn.query('DELETE FROM incomes WHERE id = ?', [payment.income_id]);
    }
    const state = await syncInvoicePayments(conn, payment.invoice_id);
    await logActivity(conn, 'invoice', payment.invoice_id, 'payment_removed',
      `Payment of ₹${payment.amount} removed`);
    return { invoice_id: payment.invoice_id, ...state };
  }),

  'invoices:duplicate': async ({ id }) => db.tx(async (conn) => {
    const { invoice, items } = await loadInvoice(conn, id);
    const invoiceDate = today();
    const number = await consumeNextNumber(conn, invoiceDate);

    const copyFields = ['client_id', 'project_id', 'bill_to_name', 'bill_to_address',
      'bill_to_gstin', 'bill_from_name', 'bill_from_address', 'bill_from_gstin',
      'place_of_supply', 'currency_symbol', 'gst_mode', 'gst_rate', 'gst_amount',
      'subtotal', 'discount_type', 'discount_value', 'discount_amount',
      'taxable_amount', 'cgst_amount', 'sgst_amount', 'igst_amount',
      'shipping_amount', 'round_off', 'total', 'notes', 'terms', 'bank_details',
      'column_config'];

    const result = await conn.query(
      `INSERT INTO invoices (invoice_number, invoice_date, due_date, status, ${copyFields.join(', ')})
       VALUES (?, ?, ?, 'draft', ${copyFields.map(() => '?').join(', ')})`,
      [number, invoiceDate, invoice.due_date, ...copyFields.map((f) => invoice[f])]
    );

    if (items.length) {
      await conn.raw(
        `INSERT INTO invoice_items
         (invoice_id, position, description, hsn_sac, quantity, unit, rate, amount,
          custom_fields)
         VALUES ?`,
        [items.map((item) => [result.insertId, item.position, item.description,
          item.hsn_sac, item.quantity, item.unit, item.rate, item.amount,
          item.custom_fields || null])]
      );
    }
    await logActivity(conn, 'invoice', result.insertId, 'created',
      `Invoice ${number} copied from ${invoice.invoice_number}`);
    return { id: result.insertId, invoice_number: number };
  }),

  'invoices:delete': async ({ id }) => db.tx(async (conn) => {
    const invoice = await conn.one(
      'SELECT invoice_number, project_id, amount_paid FROM invoices WHERE id = ?', [id]
    );
    if (!invoice) throw new Error('Invoice not found.');
    if (money(invoice.amount_paid) > 0) {
      throw new Error(
        'This invoice has payments recorded against it, so deleting it would ' +
        'change your income figures. Remove the payments first, or set the ' +
        'invoice to Cancelled instead.'
      );
    }
    await conn.query('DELETE FROM invoices WHERE id = ?', [id]);
    if (invoice.project_id) await syncProjectPayment(conn, invoice.project_id);
    await logActivity(conn, 'invoice', id, 'deleted',
      `Invoice ${invoice.invoice_number} deleted`);
    return { id };
  }),

  // -- preview, PDF and printing ------------------------------------------
  /** HTML for the on-screen preview pane. */
  'invoices:previewHtml': async ({ id }) => ({ html: await buildHtml(id, { screen: true }) }),

  /** Preview an unsaved draft without touching the database. */
  'invoices:previewDraft': async (payload) => {
    const settings = await readSettings(db);
    const computed = computeInvoice(payload);
    const invoice = {
      invoice_number: str(payload.invoice_number, 60) || 'DRAFT',
      invoice_date: dateOrNull(payload.invoice_date) || today(),
      due_date: dateOrNull(payload.due_date),
      status: 'draft',
      bill_to_name: str(payload.bill_to_name, 220) || 'Customer',
      bill_to_address: str(payload.bill_to_address),
      bill_to_gstin: str(payload.bill_to_gstin, 20),
      bill_from_name: str(payload.bill_from_name, 220) || settings.company_name,
      bill_from_address: str(payload.bill_from_address) || companyAddressBlock(settings),
      bill_from_gstin: str(payload.bill_from_gstin, 20) || settings.company_gstin,
      place_of_supply: str(payload.place_of_supply, 120),
      currency_symbol: str(payload.currency_symbol, 8) || settings.currency_symbol || '₹',
      notes: str(payload.notes),
      terms: str(payload.terms),
      bank_details: str(payload.bank_details),
      column_config: computed.columns,
      amount_paid: 0,
      ...computed
    };
    return {
      html: renderInvoiceHtml({
        invoice, items: computed.items, payments: [], settings, screen: true,
        projectTitle: str(payload.project_title, 220)
      })
    };
  },

  /** Save the invoice as a PDF. Asks where to put it unless a folder is given. */
  'invoices:exportPdf': async ({ id, directory, openAfter = true }) => {
    const { invoice } = await loadInvoice(db, id);
    const settings = await readSettings(db);
    const fileName = `${safeFileName(`Invoice ${invoice.invoice_number}`)}` +
      `${invoice.bill_to_name ? ` - ${safeFileName(invoice.bill_to_name)}` : ''}.pdf`;

    let target;
    if (directory) {
      target = path.join(directory, fileName);
    } else {
      const result = await dialog.showSaveDialog({
        title: 'Save invoice PDF',
        defaultPath: path.join(
          settings.last_pdf_folder || require('electron').app.getPath('documents'),
          fileName
        ),
        filters: [{ name: 'PDF document', extensions: ['pdf'] }]
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      target = result.filePath;
      await db.query(
        `INSERT INTO app_settings (setting_key, setting_value) VALUES ('last_pdf_folder', ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [path.dirname(target)]
      );
    }

    const html = await buildHtml(id, { screen: false });
    await htmlToPdfFile(html, target);
    await logActivity(db, 'invoice', id, 'exported',
      `Invoice ${invoice.invoice_number} saved as PDF`);
    if (openAfter) shell.openPath(target);
    return { canceled: false, path: target };
  },

  /** Hand the invoice to the Windows print dialog. */
  'invoices:print': async ({ id }) => {
    const html = await buildHtml(id, { screen: false });
    const temp = writeTempHtml(html);
    const win = new BrowserWindow({
      show: false,
      webPreferences: { javascript: false, sandbox: true, contextIsolation: true }
    });
    try {
      await win.loadFile(temp.file);
      await new Promise((resolve) => setTimeout(resolve, 180));
      const printed = await new Promise((resolve) => {
        win.webContents.print(
          { silent: false, printBackground: true, pageSize: 'A4' },
          (success, reason) => resolve({ success, reason })
        );
      });
      return printed;
    } finally {
      if (!win.isDestroyed()) win.destroy();
      removeTemp(temp.dir);
    }
  },

  /**
   * Unpaid invoices, for the dashboard receivables panel.
   *
   * The row limit is clamped to an integer and inlined rather than bound as a
   * parameter: TiDB rejects `LIMIT ?` in a prepared statement
   * ("Incorrect arguments to LIMIT"), so a placeholder here would break the
   * dashboard on a cloud cluster.
   */
  'invoices:outstanding': async ({ limit } = {}) => {
    const rows = Math.min(Math.max(Math.trunc(Number(limit) || 10), 1), 200);
    return db.query(`
      SELECT i.id, i.invoice_number, i.invoice_date, i.due_date, i.total, i.amount_paid,
             (i.total - i.amount_paid) AS balance, i.status,
             COALESCE(c.name, i.bill_to_name) AS client_name,
             CASE WHEN i.due_date IS NOT NULL AND i.due_date < CURDATE()
                  THEN DATEDIFF(CURDATE(), i.due_date) ELSE 0 END AS days_overdue
      FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
      WHERE i.status IN ('sent','partially_paid')
      ORDER BY COALESCE(i.due_date, i.invoice_date) ASC
      LIMIT ${rows}`);
  }
};
