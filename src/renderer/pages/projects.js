/**
 * Projects: the work in hand. A project moves Planned -> In progress ->
 * Submitted -> Completed, and only once the client actually pays does it get
 * marked Paid — which writes the income entry for you.
 */
(function () {
  'use strict';

  window.Pages = window.Pages || {};

  const {
    api, apiSafe, esc, icon, fmt, card, stat, table, modal, toast, readForm,
    bindActions, bindRows, debounce, confirm, options, enumOptions,
    statusBadge, PROJECT_STATUS, PAYMENT_STATUS, INVOICE_STATUS,
    PAYMENT_METHODS, methodLabel, num, today, badge
  } = window.UI;

  const STATUSES = [
    ['planned', 'Planned'],
    ['in_progress', 'In progress'],
    ['submitted', 'Submitted'],
    ['completed', 'Completed'],
    ['on_hold', 'On hold'],
    ['cancelled', 'Cancelled']
  ];

  const state = { search: '', status: 'open', paymentStatus: '', clientId: '' };
  let clients = [];
  // The rows currently on screen. A status change patches the one that moved
  // and redraws from here, instead of asking the database for the lot again.
  let currentRows = [];

  window.Pages.projects = {
    title: 'Projects',
    crumb: 'Work',

    async render(ctx) {
      ctx.actions.innerHTML =
        '<button class="btn" data-action="new">' + icon('plus', 15) + 'New project</button>';
      bindActions(ctx.actions, { new: () => editor(ctx, null) });

      if (ctx.params.clientId) state.clientId = String(ctx.params.clientId);

      // Independent of each other, so both are asked for at once.
      const [clientList, rows] = await Promise.all([
        api('clients:options'),
        fetchProjects()
      ]);
      clients = clientList;

      ctx.el.innerHTML = filters() + '<div id="proj-body">' + window.UI.loading(6) + '</div>';
      wireFilters(ctx);
      renderProjects(ctx, rows);

      if (ctx.params.action === 'new') {
        editor(ctx, null, { client_id: ctx.params.clientId || '' });
      }
      if (ctx.params.action === 'open' && ctx.params.id) detail(ctx, ctx.params.id);
    }
  };

  function filters() {
    return '<div class="filters">' +
      '<div class="field"><label>Status</label><select id="p-status">' +
        '<option value="open"' + (state.status === 'open' ? ' selected' : '') +
        '>Open (not finished)</option>' +
        '<option value=""' + (state.status === '' ? ' selected' : '') + '>Everything</option>' +
        enumOptions(STATUSES, state.status) +
        '</select></div>' +
      '<div class="field"><label>Payment</label><select id="p-payment">' +
        enumOptions([['unpaid', 'Unpaid'], ['partial', 'Part paid'], ['paid', 'Paid']],
          state.paymentStatus, 'Any') + '</select></div>' +
      '<div class="field"><label>Client</label><select id="p-client">' +
        options(clients, { selected: state.clientId, blank: 'All clients',
          label: (c) => c.company || c.name }) + '</select></div>' +
      '<div class="field grow"><label>Search</label><div class="search-box">' +
        icon('search', 14) + '<input type="text" id="p-search" placeholder="Project or client" ' +
        'value="' + esc(state.search) + '" spellcheck="false"></div></div>' +
      '</div>';
  }

  function wireFilters(ctx) {
    document.getElementById('p-status').addEventListener('change', (event) => {
      state.status = event.target.value; load(ctx);
    });
    document.getElementById('p-payment').addEventListener('change', (event) => {
      state.paymentStatus = event.target.value; load(ctx);
    });
    document.getElementById('p-client').addEventListener('change', (event) => {
      state.clientId = event.target.value; load(ctx);
    });
    const search = document.getElementById('p-search');
    search.addEventListener('input', debounce(() => {
      state.search = search.value.trim(); load(ctx);
    }, 240));
  }

  /** Just the data, so the caller can fetch it alongside something else. */
  function fetchProjects() {
    return api('projects:list', {
      search: state.search || undefined,
      status: state.status || undefined,
      paymentStatus: state.paymentStatus || undefined,
      clientId: state.clientId || undefined
    });
  }

  async function load(ctx) {
    const host = document.getElementById('proj-body');
    host.innerHTML = window.UI.loading(6);
    renderProjects(ctx, await fetchProjects());
  }

  function renderProjects(ctx, rows) {
    currentRows = rows;
    const host = document.getElementById('proj-body');

    const value = rows.reduce((sum, row) => sum + num(row.amount), 0);
    const received = rows.reduce((sum, row) => sum + num(row.amount_paid), 0);
    const pending = value - received;
    const awaiting = rows.filter((row) =>
      row.status === 'completed' && row.payment_status !== 'paid').length;

    host.innerHTML =
      '<div class="grid c4 mb14">' +
        stat({ label: 'Projects shown', value: fmt.number(rows.length), accent: true,
          sub: '<span class="faint">' + fmt.money(value) + ' of work</span>' }) +
        stat({ label: 'Received', value: fmt.moneyShort(received), small: true,
          sub: '<span class="faint">' +
            (value ? fmt.percent((received / value) * 100, 0) + ' collected' : '—') +
            '</span>' }) +
        stat({ label: 'Still to collect', value: fmt.moneyShort(pending), small: true,
          sub: pending > 0 ? '<span class="delta down">outstanding</span>'
            : '<span class="faint">nothing pending</span>' }) +
        stat({ label: 'Done, awaiting payment', value: fmt.number(awaiting), small: true,
          sub: '<span class="faint">ready to chase</span>' }) +
      '</div>' +

      card({
        title: 'Projects',
        hint: 'Click a row for the full record',
        flush: true,
        body: table([
          { label: 'Project', render: (row) =>
            '<div class="row-title">' + esc(row.title) +
            (row.code ? ' <span class="faint mono tiny">' + esc(row.code) + '</span>' : '') +
            '</div>' +
            '<div class="row-sub">' +
            esc(row.client_company || row.client_name || 'No client') + '</div>' },
          { label: 'Status', render: (row) => statusBadge(PROJECT_STATUS, row.status) },
          { label: 'Deadline', render: (row) => {
            if (!row.due_date) return '<span class="faint">—</span>';
            const days = daysUntil(row.due_date);
            const open = ['planned', 'in_progress', 'submitted', 'on_hold'].includes(row.status);
            return fmt.dateShort(row.due_date) +
              (open
                ? '<div class="row-sub' + (days < 0 ? ' neg' : '') + '">' +
                  esc(fmt.due(days)) + '</div>'
                : '');
          } },
          { label: 'Value', className: 'num', render: (row) => fmt.money(row.amount) },
          { label: 'Paid', className: 'num', render: (row) =>
            num(row.amount_paid)
              ? fmt.money(row.amount_paid) +
                (num(row.balance) > 0
                  ? '<div class="row-sub neg">' + fmt.money(row.balance) + ' due</div>' : '')
              : '<span class="faint">—</span>' },
          { label: 'Payment', render: (row) => statusBadge(PAYMENT_STATUS, row.payment_status) },
          { label: 'Billed', render: (row) =>
            num(row.invoice_count)
              ? badge(row.invoice_count + ' invoice' + (num(row.invoice_count) === 1 ? '' : 's'))
              : '<span class="faint">not yet</span>' },
          { label: '', className: 'actions', render: (row) => rowActions(row) }
        ], {
          rows,
          onRowClick: true,
          footer: rows.length
            ? '<tr><td colspan="3">Totals</td><td class="num">' + fmt.money(value) +
              '</td><td class="num">' + fmt.money(received) + '</td><td colspan="3"></td></tr>'
            : '',
          empty: {
            icon: 'projects',
            title: hasFilters() ? 'No project matches these filters' : 'No projects yet',
            message: hasFilters()
              ? 'Try "Everything" under Status, or clear the search.'
              : 'Add a project for every job you take on, with the agreed amount. ' +
                'Update its status as the work moves along; when it is done and the ' +
                'client has paid, mark it paid and the income is recorded for you.',
            action: hasFilters() ? '' : 'new',
            actionLabel: 'Add your first project'
          }
        })
      });

    bindRows(host, rows, (row) => detail(ctx, row.id));
    bindActions(host, {
      new: () => editor(ctx, null),
      edit: (ds) => editor(ctx, Number(ds.id)),
      advance: (ds) => advance(ctx, ds),
      pay: (ds) => paymentDialog(ctx, Number(ds.id)),
      markPaid: (ds) => markPaid(ctx, ds),
      bill: (ds) => ctx.go('invoices', { action: 'new', projectId: Number(ds.id) })
    });
  }

  /** The one button that makes sense next for this project. */
  function rowActions(row) {
    const next = {
      planned: ['in_progress', 'Start work'],
      in_progress: ['submitted', 'Mark submitted'],
      submitted: ['completed', 'Mark completed'],
      on_hold: ['in_progress', 'Resume']
    }[row.status];

    let html = '';
    if (next) {
      html += '<button class="btn sm secondary" data-action="advance" data-id="' + row.id +
        '" data-status="' + next[0] + '" data-title="' + esc(row.title) + '">' +
        esc(next[1]) + '</button>';
    }
    if (row.status === 'completed' && row.payment_status !== 'paid') {
      if (!num(row.invoice_count)) {
        html += '<button class="btn sm secondary" data-action="bill" data-id="' + row.id +
          '">Bill it</button>';
      }
      html += '<button class="btn sm" data-action="markPaid" data-id="' + row.id +
        '" data-title="' + esc(row.title) + '" data-balance="' + row.balance + '">Mark paid</button>';
    }
    html += '<button class="btn sm ghost" data-action="edit" data-id="' + row.id +
      '" title="Edit">' + icon('edit', 13) + '</button>';
    return html;
  }

  function hasFilters() {
    return Boolean(state.search || state.paymentStatus || state.clientId) || state.status !== '';
  }

  function daysUntil(dateStr) {
    const target = window.UI.parseDate(dateStr);
    if (!target) return 0;
    const now = window.UI.parseDate(today());
    return Math.round((target.getTime() - now.getTime()) / 86400000);
  }

  // =========================================================================
  // Status changes and payments
  // =========================================================================

  /**
   * Replace one row with the version the server just returned and redraw.
   * No round trip, so the badge changes the instant the action completes.
   */
  function applyRow(ctx, row) {
    if (!row) { load(ctx); return; }
    const index = currentRows.findIndex((r) => Number(r.id) === Number(row.id));
    const rows = currentRows.slice();
    if (index >= 0) rows[index] = row;
    else rows.unshift(row);
    renderProjects(ctx, rows);
  }

  async function advance(ctx, ds) {
    const result = await apiSafe('projects:setStatus', {
      id: Number(ds.id), status: ds.status
    });
    if (!result) return;
    // Update the row first so the new status is on screen before anything else.
    applyRow(ctx, result.row);
    toast('"' + ds.title + '" is now ' + fmt.label(ds.status).toLowerCase(), 'success');

    // Completing a project is the moment to raise the bill, so offer it.
    if (ds.status === 'completed') {
      const bill = await confirm({
        title: 'Raise an invoice?',
        message: 'The project is complete. Create an invoice for it now?',
        detail: 'The project title and amount are filled in for you; you can add GST ' +
          'and more line items before saving.',
        confirmLabel: 'Create invoice'
      });
      if (bill) ctx.go('invoices', { action: 'new', projectId: Number(ds.id) });
    }
  }

  async function markPaid(ctx, ds) {
    const ok = await confirm({
      title: 'Mark project as paid',
      message: 'Record ' + fmt.money(ds.balance) + ' received for "' + ds.title + '"?',
      detail: 'An income entry dated today is created, and the project is marked fully paid.',
      confirmLabel: 'Record payment'
    });
    if (!ok) return;
    const result = await apiSafe('projects:markPaid', { id: Number(ds.id) });
    if (result) { applyRow(ctx, result.row); toast('Project marked paid', 'success'); }
  }

  function paymentDialog(ctx, id, projectInfo) {
    const balance = projectInfo
      ? Math.max(0, num(projectInfo.amount) - num(projectInfo.amount_paid)) : '';

    const handle = modal({
      title: 'Record a payment',
      sub: projectInfo ? projectInfo.title : 'Part payment or advance',
      size: 'narrow',
      body:
        '<div class="field"><label>Amount received <span class="req">*</span></label>' +
          '<div class="input-prefix"><span>' +
          esc(window.App.settings.currency_symbol || '₹') + '</span>' +
          '<input type="number" step="0.01" min="0" class="num" data-field="amount" ' +
          'value="' + esc(balance === '' ? '' : balance.toFixed(2)) + '"></div>' +
          (balance !== ''
            ? '<div class="help">Balance outstanding: ' + fmt.money(balance) + '</div>' : '') +
        '</div>' +
        '<div class="field"><label>Received on</label>' +
          '<input type="date" data-field="received_on" value="' + today() + '"></div>' +
        '<div class="field"><label>Payment mode</label><select data-field="method">' +
          enumOptions(PAYMENT_METHODS, 'upi') + '</select></div>' +
        '<div class="field"><label>Reference</label>' +
          '<input type="text" data-field="reference" placeholder="UTR, cheque no."></div>' +
        '<div class="field"><label>Note</label>' +
          '<input type="text" data-field="description" placeholder="e.g. 50% advance"></div>',
      footer:
        '<button class="btn secondary" data-close>Cancel</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn" data-save>' + icon('check', 15) + 'Record payment</button>'
    });

    handle.el.querySelector('[data-save]').addEventListener('click', async (event) => {
      const payload = readForm(handle.body);
      if (!num(payload.amount)) { handle.error('Enter an amount greater than zero.'); return; }
      await window.UI.busy(event.currentTarget, async () => {
        try {
          const saved = await api('projects:recordPayment', Object.assign({ id }, payload));
          handle.close();
          applyRow(ctx, saved.row);
          toast('Payment recorded', 'success', 'It is now in your Income ledger too.');
        } catch (err) {
          handle.error(err.message);
        }
      });
    });
  }

  // =========================================================================
  // Create / edit
  // =========================================================================

  async function editor(ctx, id, prefill) {
    let project = {
      client_id: '', code: '', title: '', description: '', amount: '',
      status: 'planned', start_date: today(), due_date: '', notes: ''
    };
    if (id) {
      const loaded = await apiSafe('projects:get', { id });
      if (!loaded) return;
      project = loaded.project;
    } else if (prefill) {
      project = Object.assign(project, prefill);
    }

    const handle = modal({
      title: id ? 'Edit project' : 'New project',
      sub: id ? project.title : 'A job you have taken on',
      body:
        '<div class="field"><label>What is the project? <span class="req">*</span></label>' +
          '<input type="text" data-field="title" value="' + esc(project.title) + '" ' +
          'placeholder="e.g. Wedding card design + 500 prints"></div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Client</label><select data-field="client_id">' +
            options(clients, {
              selected: project.client_id,
              blank: '— no client —',
              label: (c) => c.company || c.name
            }) + '</select></div>' +
          '<div class="field"><label>Agreed amount <span class="req">*</span></label>' +
            '<div class="input-prefix"><span>' +
            esc(window.App.settings.currency_symbol || '₹') + '</span>' +
            '<input type="number" step="0.01" min="0" class="num" data-field="amount" ' +
            'value="' + esc(project.amount) + '"></div></div>' +
          '<div class="field" style="flex:0 0 130px"><label>Job code</label>' +
            '<input type="text" data-field="code" value="' + esc(project.code || '') + '" ' +
            'class="mono" placeholder="optional"></div>' +
        '</div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Status</label><select data-field="status">' +
            enumOptions(STATUSES, project.status) + '</select></div>' +
          '<div class="field"><label>Started on</label>' +
            '<input type="date" data-field="start_date" value="' +
            esc(project.start_date || '') + '"></div>' +
          '<div class="field"><label>Deadline</label>' +
            '<input type="date" data-field="due_date" value="' +
            esc(project.due_date || '') + '"></div>' +
        '</div>' +
        '<div class="field"><label>What the job involves</label>' +
          '<textarea data-field="description" placeholder="Details that should appear on ' +
          'the invoice line">' + esc(project.description || '') + '</textarea></div>' +
        '<div class="field"><label>Private notes</label>' +
          '<textarea data-field="notes" placeholder="Not printed anywhere">' +
          esc(project.notes || '') + '</textarea></div>',
      footer:
        '<button class="btn secondary" data-close>Cancel</button>' +
        '<span class="spacer"></span>' +
        (id ? '<button class="btn danger" data-remove>' + icon('trash', 14) + 'Delete</button>' : '') +
        '<button class="btn" data-save>' + icon('check', 15) +
        (id ? 'Save changes' : 'Create project') + '</button>'
    });

    handle.el.querySelector('[data-save]').addEventListener('click', async (event) => {
      const payload = readForm(handle.body);
      if (!String(payload.title || '').trim()) { handle.error('Give the project a title.'); return; }
      await window.UI.busy(event.currentTarget, async () => {
        try {
          await api('projects:save', Object.assign({ id }, payload));
          handle.close();
          toast(id ? 'Project updated' : 'Project created', 'success');
          load(ctx);
        } catch (err) {
          handle.error(err.message);
        }
      });
    });

    const removeButton = handle.el.querySelector('[data-remove]');
    if (removeButton) {
      removeButton.addEventListener('click', async () => {
        const ok = await confirm({
          title: 'Delete project',
          message: 'Delete "' + project.title + '"?',
          detail: 'Only possible while no income is attached. To close a dead job and ' +
            'keep the record, set its status to Cancelled instead.',
          confirmLabel: 'Delete project',
          danger: true
        });
        if (!ok) return;
        try {
          await api('projects:delete', { id });
          handle.close();
          toast('Project deleted', 'success');
          load(ctx);
        } catch (err) {
          handle.error(err.message);
        }
      });
    }
  }

  // =========================================================================
  // Detail
  // =========================================================================

  async function detail(ctx, id) {
    const data = await apiSafe('projects:get', { id });
    if (!data) return;
    const project = data.project;
    const balance = num(project.amount) - num(project.amount_paid);
    const costs = data.expenses.reduce((sum, row) => sum + num(row.amount), 0);
    const profit = num(project.amount) - costs;

    const handle = modal({
      title: project.title,
      sub: (project.client_company || project.client_name || 'No client') +
        (project.code ? '  ·  ' + project.code : ''),
      size: 'wide',
      body:
        '<div class="flex wrap mb14">' +
          statusBadge(PROJECT_STATUS, project.status) +
          statusBadge(PAYMENT_STATUS, project.payment_status) +
          (project.due_date
            ? badge('Deadline ' + fmt.date(project.due_date),
              daysUntil(project.due_date) < 0 &&
              !['completed', 'cancelled'].includes(project.status) ? 'bad' : '')
            : '') +
          (project.completed_on ? badge('Completed ' + fmt.date(project.completed_on), 'good') : '') +
        '</div>' +

        '<div class="grid c4 mb14">' +
          window.UI.stat({ label: 'Agreed amount', value: fmt.moneyShort(project.amount),
            accent: true }) +
          window.UI.stat({ label: 'Received', value: fmt.moneyShort(project.amount_paid),
            small: true, sub: '<span class="faint">' + data.payments.length +
            ' payment' + (data.payments.length === 1 ? '' : 's') + '</span>' }) +
          window.UI.stat({ label: 'Balance', value:
            '<span class="' + (balance > 0 ? 'neg' : 'pos') + '">' +
            fmt.moneyShort(balance) + '</span>', small: true }) +
          window.UI.stat({ label: 'Job costs', value: fmt.moneyShort(costs), small: true,
            sub: costs
              ? '<span class="faint">margin ' + fmt.money(profit) + '</span>'
              : '<span class="faint">none tagged</span>' }) +
        '</div>' +

        (project.description
          ? card({ title: 'Scope', className: 'mb14', body:
            '<p class="small" style="margin:0;white-space:pre-wrap;line-height:1.65">' +
            esc(project.description) + '</p>' })
          : '') +

        '<div class="grid c2 mb14">' +
          card({ title: 'Payments received', flush: true, body: table([
            { label: 'Date', render: (r) => fmt.dateShort(r.received_on) },
            { label: 'Mode', render: (r) =>
              '<span class="small">' + esc(methodLabel(r.method)) + '</span>' +
              (r.source !== 'manual'
                ? '<div class="row-sub">' + esc(fmt.label(r.source)) + '</div>' : '') },
            { label: 'Amount', className: 'num strong', render: (r) => fmt.money(r.amount) }
          ], { rows: data.payments, compact: true,
            empty: { icon: 'money', title: 'Nothing received yet',
              message: 'Record an advance or the final payment.' } }) }) +
          card({ title: 'Invoices', flush: true, body: table([
            { label: 'Number', className: 'mono', key: 'invoice_number' },
            { label: 'Date', render: (r) => fmt.dateShort(r.invoice_date) },
            { label: 'Total', className: 'num', render: (r) => fmt.money(r.total) },
            { label: 'Status', render: (r) => statusBadge(INVOICE_STATUS, r.status) }
          ], { rows: data.invoices, compact: true,
            empty: { icon: 'invoice', title: 'Not invoiced yet',
              message: 'Create an invoice straight from this project.' } }) }) +
        '</div>' +

        (data.expenses.length
          ? card({ title: 'Costs tagged to this job', flush: true, body: table([
            { label: 'Date', render: (r) => fmt.dateShort(r.spent_on) },
            { label: 'What', key: 'title' },
            { label: 'Category', render: (r) =>
              '<span class="small faint">' + esc(r.category_name || '—') + '</span>' },
            { label: 'Amount', className: 'num', render: (r) => fmt.money(r.amount) }
          ], { rows: data.expenses, compact: true }) })
          : '') +

        (project.notes
          ? '<div class="mt14">' + card({ title: 'Private notes', body:
            '<p class="small" style="margin:0;white-space:pre-wrap;line-height:1.65">' +
            esc(project.notes) + '</p>' }) + '</div>'
          : ''),

      footer:
        '<button class="btn secondary" data-close>Close</button>' +
        '<button class="btn secondary" data-act="edit">' + icon('edit', 14) + 'Edit</button>' +
        '<span class="spacer"></span>' +
        statusButtons(project) +
        '<button class="btn secondary" data-act="payment">' + icon('money', 14) +
        'Record payment</button>' +
        '<button class="btn secondary" data-act="bill">' + icon('invoice', 14) + 'Invoice</button>' +
        (project.status === 'completed' && project.payment_status !== 'paid'
          ? '<button class="btn" data-act="markPaid">' + icon('check', 15) + 'Mark paid</button>'
          : '')
    });

    const act = (name, fn) => {
      const button = handle.el.querySelector('[data-act="' + name + '"]');
      if (button) button.addEventListener('click', fn);
    };

    act('edit', () => { handle.close(); editor(ctx, id); });
    act('payment', () => { handle.close(); paymentDialog(ctx, id, project); });
    act('bill', () => { handle.close(); ctx.go('invoices', { action: 'new', projectId: id }); });
    act('markPaid', async () => {
      handle.close();
      await markPaid(ctx, { id, title: project.title, balance });
    });
    act('status', async (event) => {
      const next = event.currentTarget.getAttribute('data-status');
      handle.close();
      await advance(ctx, { id, status: next, title: project.title });
    });
  }

  function statusButtons(project) {
    const next = {
      planned: ['in_progress', 'Start work'],
      in_progress: ['submitted', 'Mark submitted'],
      submitted: ['completed', 'Mark completed'],
      on_hold: ['in_progress', 'Resume']
    }[project.status];
    if (!next) return '';
    return '<button class="btn secondary" data-act="status" data-status="' + next[0] + '">' +
      icon('check', 14) + esc(next[1]) + '</button>';
  }
})();
