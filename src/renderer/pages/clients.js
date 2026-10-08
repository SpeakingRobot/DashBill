/** Clients: the register that feeds every "existing client" dropdown. */
(function () {
  'use strict';

  window.Pages = window.Pages || {};

  const {
    api, apiSafe, esc, icon, fmt, card, table, modal, toast, readForm,
    bindActions, bindRows, debounce, confirm, statusBadge, PROJECT_STATUS,
    PAYMENT_STATUS, INVOICE_STATUS, num
  } = window.UI;

  const state = { search: '', includeInactive: false };

  window.Pages.clients = {
    title: 'Clients',
    crumb: 'Work',

    async render(ctx) {
      ctx.actions.innerHTML =
        '<button class="btn" data-action="new">' + icon('plus', 15) + 'Add client</button>';
      bindActions(ctx.actions, { new: () => editor(ctx, null) });

      ctx.el.innerHTML = filters() + '<div id="clients-list">' + window.UI.loading(6) + '</div>';
      wireFilters(ctx);
      await load(ctx);

      if (ctx.params.action === 'new') editor(ctx, null);
      if (ctx.params.action === 'open' && ctx.params.id) detail(ctx, ctx.params.id);
    }
  };

  function filters() {
    return '<div class="filters">' +
      '<div class="field grow"><label>Search</label>' +
        '<div class="search-box">' + icon('search', 14) +
        '<input type="text" id="c-search" placeholder="Name, company, phone or email" ' +
        'value="' + esc(state.search) + '" spellcheck="false"></div>' +
      '</div>' +
      '<span class="spacer"></span>' +
      '<label class="check" style="margin-bottom:6px"><input type="checkbox" id="c-inactive"' +
      (state.includeInactive ? ' checked' : '') + '><span>Show inactive</span></label>' +
      '</div>';
  }

  function wireFilters(ctx) {
    const search = document.getElementById('c-search');
    search.addEventListener('input', debounce(() => {
      state.search = search.value.trim();
      load(ctx);
    }, 240));
    document.getElementById('c-inactive').addEventListener('change', (event) => {
      state.includeInactive = event.target.checked;
      load(ctx);
    });
  }

  async function load(ctx) {
    const host = document.getElementById('clients-list');
    host.innerHTML = window.UI.loading(6);

    const rows = await api('clients:list', {
      search: state.search || undefined,
      includeInactive: state.includeInactive ? 1 : 0
    });

    const totalBusiness = rows.reduce((sum, row) => sum + num(row.total_received), 0);
    const totalOutstanding = rows.reduce((sum, row) => sum + num(row.outstanding), 0);

    host.innerHTML = card({
      title: rows.length + ' client' + (rows.length === 1 ? '' : 's'),
      hint: fmt.money(totalBusiness) + ' received · ' + fmt.money(totalOutstanding) + ' outstanding',
      flush: true,
      body: table([
        { label: 'Client', render: (row) =>
          '<div class="row-title">' + esc(row.name) +
          (row.is_active ? '' : ' <span class="badge quiet">Inactive</span>') + '</div>' +
          (row.company && row.company !== row.name
            ? '<div class="row-sub">' + esc(row.company) + '</div>' : '') },
        { label: 'Contact', render: (row) =>
          (row.phone ? esc(row.phone) : '<span class="faint">—</span>') +
          (row.email ? '<div class="row-sub truncate">' + esc(row.email) + '</div>' : '') },
        { label: 'GSTIN', className: 'mono', render: (row) =>
          row.gstin ? esc(row.gstin) : '<span class="faint">—</span>' },
        { label: 'Projects', className: 'num', render: (row) =>
          num(row.project_count) || '<span class="faint">—</span>' },
        { label: 'Received', className: 'num', render: (row) =>
          num(row.total_received) ? '<span class="strong">' + fmt.money(row.total_received) + '</span>'
            : '<span class="faint">—</span>' },
        { label: 'Outstanding', className: 'num', render: (row) =>
          num(row.outstanding)
            ? '<span class="neg strong">' + fmt.money(row.outstanding) + '</span>'
            : '<span class="faint">—</span>' },
        { label: 'Last paid', render: (row) =>
          row.last_payment_on ? fmt.dateShort(row.last_payment_on)
            : '<span class="faint">—</span>' },
        { label: '', className: 'actions', render: (row) =>
          '<button class="btn sm ghost" data-action="edit" data-id="' + row.id + '" title="Edit">' +
          icon('edit', 13) + '</button>' +
          '<button class="btn sm secondary" data-action="newProject" data-id="' + row.id +
          '">Project</button>' +
          '<button class="btn sm secondary" data-action="bill" data-id="' + row.id +
          '">Invoice</button>' }
      ], {
        rows,
        onRowClick: true,
        empty: {
          icon: 'clients',
          title: state.search ? 'No client matches that' : 'No clients yet',
          message: state.search
            ? 'Try a different name, phone number or email.'
            : 'Register a client once, and from then on you can pick them from a ' +
              'dropdown on every income entry, project and invoice — and see ' +
              'exactly how much business each one brings you.',
          action: state.search ? '' : 'new',
          actionLabel: 'Add your first client'
        }
      })
    });

    bindRows(host, rows, (row) => detail(ctx, row.id));
    bindActions(host, {
      new: () => editor(ctx, null),
      edit: (ds) => editor(ctx, Number(ds.id)),
      newProject: (ds) => ctx.go('projects', { action: 'new', clientId: Number(ds.id) }),
      bill: (ds) => ctx.go('invoices', { action: 'new', clientId: Number(ds.id) })
    });
  }

  // =========================================================================
  // Add / edit
  // =========================================================================

  async function editor(ctx, id) {
    let client = {
      name: '', company: '', email: '', phone: '', gstin: '', pan: '',
      address_line1: '', address_line2: '', city: '', state: '', pincode: '',
      country: 'India', notes: '', is_active: 1
    };
    if (id) {
      const loaded = await apiSafe('clients:get', { id });
      if (!loaded) return;
      client = loaded.client;
    }

    const handle = modal({
      title: id ? 'Edit client' : 'New client',
      sub: id ? client.name : 'Register a client so you can reuse them everywhere',
      body:
        '<div class="field-row">' +
          field('Name', 'name', client.name, { required: true, placeholder: 'Contact or business name' }) +
          field('Company / billing name', 'company', client.company,
            { placeholder: 'Printed on the invoice' }) +
        '</div>' +
        '<div class="field-row">' +
          field('Phone', 'phone', client.phone, { type: 'tel' }) +
          field('Email', 'email', client.email, { type: 'email' }) +
        '</div>' +
        '<div class="field-row">' +
          field('GSTIN', 'gstin', client.gstin, { placeholder: '15 characters', mono: true }) +
          field('PAN', 'pan', client.pan, { mono: true }) +
        '</div>' +
        '<hr class="divider">' +
        '<div class="section-title">Billing address</div>' +
        field('Address line 1', 'address_line1', client.address_line1) +
        field('Address line 2', 'address_line2', client.address_line2) +
        '<div class="field-row">' +
          field('City', 'city', client.city) +
          field('State', 'state', client.state,
            { help: 'Decides CGST+SGST or IGST on invoices' }) +
          field('PIN code', 'pincode', client.pincode) +
        '</div>' +
        '<hr class="divider">' +
        '<div class="field"><label>Notes</label>' +
        '<textarea data-field="notes" placeholder="Anything worth remembering about this client">' +
        esc(client.notes) + '</textarea></div>' +
        (id
          ? '<label class="check"><input type="checkbox" data-field="is_active"' +
            (client.is_active ? ' checked' : '') +
            '><span>Active<small>Inactive clients stay in your history but drop out ' +
            'of the dropdowns.</small></span></label>'
          : ''),
      footer:
        '<button class="btn secondary" data-close>Cancel</button>' +
        '<span class="spacer"></span>' +
        (id ? '<button class="btn danger" data-save="delete">' + icon('trash', 14) + 'Delete</button>' : '') +
        '<button class="btn" data-save="save">' + icon('check', 15) +
        (id ? 'Save changes' : 'Add client') + '</button>'
    });

    handle.el.querySelector('[data-save="save"]').addEventListener('click', async (event) => {
      const payload = readForm(handle.body);
      if (!payload.name || !payload.name.trim()) {
        handle.error('A client name is required.');
        return;
      }
      await window.UI.busy(event.currentTarget, async () => {
        try {
          await api('clients:save', Object.assign({ id }, payload));
          handle.close();
          toast(id ? 'Client updated' : 'Client added', 'success');
          load(ctx);
        } catch (err) {
          handle.error(err.message);
        }
      });
    });

    const deleteButton = handle.el.querySelector('[data-save="delete"]');
    if (deleteButton) {
      deleteButton.addEventListener('click', async () => {
        const ok = await confirm({
          title: 'Delete client',
          message: 'Delete "' + client.name + '"?',
          detail: 'Their projects, income entries and invoices are kept — they simply ' +
            'stop being linked to a client, so your totals never change. ' +
            'If you only want them out of the dropdowns, untick Active instead.',
          confirmLabel: 'Delete client',
          danger: true
        });
        if (!ok) return;
        const result = await apiSafe('clients:delete', { id });
        if (result) {
          handle.close();
          toast('Client deleted', 'success');
          load(ctx);
        }
      });
    }
  }

  function field(label, key, value, config) {
    const cfg = config || {};
    return '<div class="field"><label>' + esc(label) +
      (cfg.required ? ' <span class="req">*</span>' : '') + '</label>' +
      '<input type="' + (cfg.type || 'text') + '" data-field="' + key + '" ' +
      'value="' + esc(value === null || value === undefined ? '' : value) + '"' +
      (cfg.placeholder ? ' placeholder="' + esc(cfg.placeholder) + '"' : '') +
      (cfg.mono ? ' class="mono" spellcheck="false"' : '') + '>' +
      (cfg.help ? '<div class="help">' + esc(cfg.help) + '</div>' : '') +
      '</div>';
  }

  // =========================================================================
  // Client detail
  // =========================================================================

  async function detail(ctx, id) {
    const data = await apiSafe('clients:get', { id });
    if (!data) return;
    const client = data.client;

    const received = data.incomes.reduce((sum, row) => sum + num(row.amount), 0);
    const projectValue = data.projects.reduce((sum, row) => sum + num(row.amount), 0);
    const outstanding = data.invoices
      .filter((row) => ['sent', 'partially_paid'].includes(row.status))
      .reduce((sum, row) => sum + (num(row.total) - num(row.amount_paid)), 0);

    const address = [
      client.address_line1, client.address_line2,
      [client.city, client.state, client.pincode].filter(Boolean).join(', ')
    ].filter(Boolean).join('\n');

    const handle = modal({
      title: client.company || client.name,
      sub: client.company && client.company !== client.name ? client.name : 'Client record',
      size: 'wide',
      body:
        '<div class="grid c3 mb14">' +
          window.UI.stat({ label: 'Received', value: fmt.moneyShort(received), accent: true,
            sub: data.incomes.length + ' payment' + (data.incomes.length === 1 ? '' : 's') }) +
          window.UI.stat({ label: 'Project value', value: fmt.moneyShort(projectValue),
            sub: data.projects.length + ' project' + (data.projects.length === 1 ? '' : 's') }) +
          window.UI.stat({ label: 'Outstanding', value: fmt.moneyShort(outstanding),
            sub: outstanding > 0 ? 'on open invoices' : 'nothing pending' }) +
        '</div>' +

        '<div class="grid c2 mb14">' +
          card({ title: 'Contact', body:
            '<dl class="kv">' +
              row('Phone', client.phone) +
              row('Email', client.email) +
              row('GSTIN', client.gstin, true) +
              row('PAN', client.pan, true) +
              (address ? '<dt>Address</dt><dd class="wrap">' +
                esc(address).replace(/\n/g, '<br>') + '</dd>' : '') +
              row('Added', fmt.date(client.created_at)) +
            '</dl>' }) +
          card({ title: 'Notes', body: client.notes
            ? '<p class="small" style="margin:0;white-space:pre-wrap;line-height:1.6">' +
              esc(client.notes) + '</p>'
            : '<p class="small faint" style="margin:0">No notes recorded.</p>' }) +
        '</div>' +

        card({ title: 'Projects', flush: true, className: 'mb14', body: table([
          { label: 'Project', key: 'title' },
          { label: 'Value', className: 'num', render: (r) => fmt.money(r.amount) },
          { label: 'Status', render: (r) => statusBadge(PROJECT_STATUS, r.status) },
          { label: 'Payment', render: (r) => statusBadge(PAYMENT_STATUS, r.payment_status) },
          { label: 'Due', render: (r) => r.due_date ? fmt.dateShort(r.due_date) : '—' }
        ], { rows: data.projects, compact: true,
          empty: { icon: 'projects', title: 'No projects', message: 'Nothing recorded for this client yet.' } }) }) +

        '<div class="grid c2">' +
          card({ title: 'Invoices', flush: true, body: table([
            { label: 'Number', className: 'mono', key: 'invoice_number' },
            { label: 'Date', render: (r) => fmt.dateShort(r.invoice_date) },
            { label: 'Total', className: 'num', render: (r) => fmt.money(r.total) },
            { label: 'Status', render: (r) => statusBadge(INVOICE_STATUS, r.status) }
          ], { rows: data.invoices, compact: true,
            empty: { icon: 'invoice', title: 'No invoices', message: 'None raised yet.' } }) }) +
          card({ title: 'Payments received', flush: true, body: table([
            { label: 'Date', render: (r) => fmt.dateShort(r.received_on) },
            { label: 'For', render: (r) =>
              '<span class="truncate">' + esc(r.description || r.category) + '</span>' },
            { label: 'Amount', className: 'num strong', render: (r) => fmt.money(r.amount) }
          ], { rows: data.incomes, compact: true,
            empty: { icon: 'money', title: 'No payments', message: 'Nothing received yet.' } }) }) +
        '</div>',
      footer:
        '<button class="btn secondary" data-close>Close</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn secondary" data-go="project">' + icon('projects', 14) + 'New project</button>' +
        '<button class="btn secondary" data-go="income">' + icon('income', 14) + 'Record income</button>' +
        '<button class="btn" data-go="invoice">' + icon('invoice', 14) + 'New invoice</button>'
    });

    handle.el.querySelector('[data-go="project"]').addEventListener('click', () => {
      handle.close();
      ctx.go('projects', { action: 'new', clientId: id });
    });
    handle.el.querySelector('[data-go="income"]').addEventListener('click', () => {
      handle.close();
      ctx.go('income', { action: 'new', clientId: id });
    });
    handle.el.querySelector('[data-go="invoice"]').addEventListener('click', () => {
      handle.close();
      ctx.go('invoices', { action: 'new', clientId: id });
    });
  }

  function row(label, value, mono) {
    if (!value) return '';
    return '<dt>' + esc(label) + '</dt><dd' + (mono ? ' class="mono"' : '') + '>' +
      esc(value) + '</dd>';
  }
})();
