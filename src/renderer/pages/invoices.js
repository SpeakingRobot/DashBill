/**
 * Invoices: raise a bill from a project or from scratch, preview the exact PDF,
 * record what the client pays, and keep every bill you have ever issued.
 */
(function () {
  'use strict';

  window.Pages = window.Pages || {};

  const {
    api, apiSafe, esc, icon, fmt, card, stat, table, modal, toast, readForm,
    bindActions, bindRows, debounce, confirm, options, enumOptions,
    statusBadge, INVOICE_STATUS, PAYMENT_METHODS, methodLabel, num, money,
    today, badge
  } = window.UI;

  const STATUSES = [
    ['draft', 'Draft'],
    ['sent', 'Sent'],
    ['partially_paid', 'Part paid'],
    ['paid', 'Paid'],
    ['cancelled', 'Cancelled']
  ];

  const GST_MODES = [
    ['none', 'No GST'],
    ['gst', 'GST (one combined line)'],
    ['cgst_sgst', 'CGST + SGST (same state)'],
    ['igst', 'IGST (other state)']
  ];

  /** Default line-item columns: description, quantity, rate, amount. */
  const DEFAULT_COLUMNS = { quantity: true, hsn: false, unit: false, custom: [] };

  /** Read a stored column_config, whatever shape it arrives in. */
  function readColumns(raw) {
    let value = raw;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { value = null; }
    }
    if (!value || typeof value !== 'object') return Object.assign({}, DEFAULT_COLUMNS);
    return {
      quantity: value.quantity === undefined ? true : Boolean(value.quantity),
      hsn: Boolean(value.hsn),
      unit: Boolean(value.unit),
      custom: (Array.isArray(value.custom) ? value.custom : [])
        .filter((c) => c && c.label).slice(0, 4)
        .map((c, i) => ({ id: String(c.id || ('c' + (i + 1))), label: String(c.label) }))
    };
  }

  const state = { search: '', status: '', clientId: '', from: '', to: '' };
  let clients = [];

  window.Pages.invoices = {
    title: 'Invoices',
    crumb: 'Work',

    async render(ctx) {
      ctx.actions.innerHTML =
        '<button class="btn secondary" data-action="export">' + icon('download', 15) + 'Export CSV</button>' +
        '<button class="btn" data-action="new">' + icon('plus', 15) + 'New invoice</button>';
      bindActions(ctx.actions, {
        new: () => editor(ctx, { }),
        export: () => apiSafe('backup:exportCsv', {
          from: state.from || undefined, to: state.to || undefined
        })
      });

      clients = await api('clients:options');
      if (ctx.params.status) state.status = ctx.params.status;
      if (ctx.params.clientId) state.clientId = String(ctx.params.clientId);

      ctx.el.innerHTML = filters() + '<div id="inv-body">' + window.UI.loading(6) + '</div>';
      wireFilters(ctx);
      await load(ctx);

      if (ctx.params.action === 'new') {
        editor(ctx, {
          clientId: ctx.params.clientId || null,
          projectId: ctx.params.projectId || null
        });
      }
      if (ctx.params.action === 'open' && ctx.params.id) viewer(ctx, ctx.params.id);
    }
  };

  function filters() {
    return '<div class="filters">' +
      '<div class="field"><label>Status</label><select id="v-status">' +
        '<option value=""' + (state.status === '' ? ' selected' : '') + '>All invoices</option>' +
        '<option value="outstanding"' + (state.status === 'outstanding' ? ' selected' : '') +
        '>Awaiting payment</option>' +
        '<option value="overdue"' + (state.status === 'overdue' ? ' selected' : '') +
        '>Overdue</option>' +
        enumOptions(STATUSES, state.status) + '</select></div>' +
      '<div class="field"><label>Client</label><select id="v-client">' +
        options(clients, { selected: state.clientId, blank: 'All clients',
          label: (c) => c.company || c.name }) + '</select></div>' +
      '<div class="field"><label>From</label>' +
        '<input type="date" id="v-from" value="' + esc(state.from) + '"></div>' +
      '<div class="field"><label>To</label>' +
        '<input type="date" id="v-to" value="' + esc(state.to) + '"></div>' +
      '<div class="field grow"><label>Search</label><div class="search-box">' +
        icon('search', 14) + '<input type="text" id="v-search" ' +
        'placeholder="Invoice number, client or project" value="' + esc(state.search) +
        '" spellcheck="false"></div></div>' +
      '</div>';
  }

  function wireFilters(ctx) {
    document.getElementById('v-status').addEventListener('change', (event) => {
      state.status = event.target.value; load(ctx);
    });
    document.getElementById('v-client').addEventListener('change', (event) => {
      state.clientId = event.target.value; load(ctx);
    });
    ['from', 'to'].forEach((key) => {
      document.getElementById('v-' + key).addEventListener('change', (event) => {
        state[key] = event.target.value; load(ctx);
      });
    });
    const search = document.getElementById('v-search');
    search.addEventListener('input', debounce(() => {
      state.search = search.value.trim(); load(ctx);
    }, 240));
  }

  async function load(ctx) {
    const host = document.getElementById('inv-body');
    host.innerHTML = window.UI.loading(6);

    const data = await api('invoices:list', {
      search: state.search || undefined,
      status: state.status || undefined,
      clientId: state.clientId || undefined,
      from: state.from || undefined,
      to: state.to || undefined
    });

    const totals = data.totals || {};

    host.innerHTML =
      '<div class="grid c4 mb14">' +
        stat({ label: 'Billed', value: fmt.moneyShort(totals.billed), accent: true,
          sub: '<span class="faint">' + num(totals.count) + ' invoice' +
            (num(totals.count) === 1 ? '' : 's') + '</span>' }) +
        stat({ label: 'Received', value: fmt.moneyShort(totals.received), small: true,
          sub: '<span class="faint">' +
            (num(totals.billed)
              ? fmt.percent((num(totals.received) / num(totals.billed)) * 100, 0) + ' collected'
              : '—') + '</span>' }) +
        stat({ label: 'Outstanding', value: fmt.moneyShort(totals.outstanding), small: true,
          sub: num(totals.outstanding) > 0
            ? '<span class="delta down">to be collected</span>'
            : '<span class="faint">nothing pending</span>' }) +
        stat({ label: 'GST charged', value: fmt.moneyShort(totals.gst_collected), small: true,
          sub: '<span class="faint">on these invoices</span>' }) +
      '</div>' +

      card({
        title: 'Invoices',
        hint: 'Click a row to open the bill',
        flush: true,
        body: table([
          { label: 'Number', render: (row) =>
            '<div class="mono strong">' + esc(row.invoice_number) + '</div>' +
            '<div class="row-sub">' + fmt.date(row.invoice_date) + '</div>' },
          { label: 'Billed to', render: (row) =>
            '<div class="row-title truncate">' +
            esc(row.client_name || row.bill_to_name || '—') + '</div>' +
            (row.project_title
              ? '<div class="row-sub truncate">' + esc(row.project_title) + '</div>' : '') },
          { label: 'Due', render: (row) =>
            row.due_date
              ? fmt.dateShort(row.due_date) +
                (num(row.days_overdue) > 0
                  ? '<div class="row-sub neg">' + row.days_overdue + 'd overdue</div>' : '')
              : '<span class="faint">—</span>' },
          { label: 'Tax', render: (row) =>
            row.gst_mode === 'none'
              ? '<span class="faint small">no GST</span>'
              : '<span class="small">' +
                ({ gst: 'GST', igst: 'IGST', cgst_sgst: 'CGST+SGST' }[row.gst_mode] || 'GST') +
                ' ' + fmt.number(row.gst_rate, 0) + '%</span>' },
          { label: 'Total', className: 'num', render: (row) =>
            '<span class="strong">' + fmt.money(row.total) + '</span>' },
          { label: 'Balance', className: 'num', render: (row) =>
            num(row.balance) > 0.009 && row.status !== 'cancelled'
              ? '<span class="neg">' + fmt.money(row.balance) + '</span>'
              : '<span class="faint">—</span>' },
          { label: 'Status', render: (row) => statusBadge(INVOICE_STATUS, row.status) },
          { label: '', className: 'actions', render: (row) =>
            (['draft', 'sent', 'partially_paid'].includes(row.status) && num(row.balance) > 0.009
              ? '<button class="btn sm secondary" data-action="pay" data-id="' + row.id +
                '">Record payment</button>'
              : '') +
            '<button class="btn sm ghost" data-action="pdf" data-id="' + row.id +
            '" title="Save as PDF">' + icon('download', 13) + '</button>' +
            '<button class="btn sm ghost" data-action="edit" data-id="' + row.id +
            '" title="Edit">' + icon('edit', 13) + '</button>' +
            '<button class="btn sm ghost" data-action="remove" data-id="' + row.id +
            '" data-number="' + esc(row.invoice_number) + '" data-paid="' +
            num(row.amount_paid) + '" title="Delete">' + icon('trash', 13) + '</button>' }
        ], {
          rows: data.rows,
          onRowClick: true,
          footer: data.rows.length
            ? '<tr><td colspan="4">Totals</td><td class="num">' + fmt.money(totals.billed) +
              '</td><td class="num">' + fmt.money(totals.outstanding) + '</td><td colspan="2"></td></tr>'
            : '',
          empty: {
            icon: 'invoice',
            title: hasFilters() ? 'No invoice matches these filters' : 'No invoices yet',
            message: hasFilters()
              ? 'Clear a filter or widen the dates.'
              : 'Create a professional GST invoice in a minute. Pick a completed ' +
                'project and the line items are filled in for you, or build one from ' +
                'scratch — then preview the exact PDF before you send it.',
            action: hasFilters() ? '' : 'new',
            actionLabel: 'Create your first invoice'
          }
        })
      });

    bindRows(host, data.rows, (row) => viewer(ctx, row.id));
    bindActions(host, {
      new: () => editor(ctx, {}),
      edit: (ds) => editor(ctx, { id: Number(ds.id) }),
      pay: (ds) => paymentDialog(ctx, Number(ds.id)),
      pdf: async (ds, button) => {
        await window.UI.busy(button, async () => {
          const result = await apiSafe('invoices:exportPdf', { id: Number(ds.id) });
          if (result && !result.canceled) toast('PDF saved', 'success', result.path);
        });
      },

      remove: async (ds) => {
        const hasPayments = num(ds.paid) > 0;
        const ok = await confirm({
          title: 'Delete invoice',
          message: 'Delete invoice ' + ds.number + '?',
          detail: hasPayments
            ? 'This invoice has payments recorded against it, so it cannot be ' +
              'deleted — deleting it would change your income figures. Set it to ' +
              'Cancelled instead, which keeps the number in sequence.'
            : 'This cannot be undone. For your records it is often better to set ' +
              'the status to Cancelled, which keeps the number in sequence.',
          confirmLabel: hasPayments ? 'Cancel the invoice' : 'Delete invoice',
          danger: true
        });
        if (!ok) return;
        try {
          if (hasPayments) {
            await api('invoices:setStatus', { id: Number(ds.id), status: 'cancelled' });
            toast('Invoice cancelled', 'success');
          } else {
            await api('invoices:delete', { id: Number(ds.id) });
            toast('Invoice deleted', 'success');
          }
          load(ctx);
        } catch (err) {
          toast('Could not delete it', 'error', err.message);
        }
      }
    });
  }

  function hasFilters() {
    return Boolean(state.search || state.status || state.clientId || state.from || state.to);
  }

  // =========================================================================
  // Totals, mirrored from the main process so the figures move as you type
  // =========================================================================

  function computeTotals(form, items, columns) {
    // With the quantity column switched off, every line is a single unit.
    const useQty = !columns || columns.quantity;
    const subtotal = money(items.reduce((sum, item) =>
      sum + money((useQty ? num(item.quantity) : 1) * num(item.rate)), 0));

    let discount = 0;
    if (form.discount_type === 'percent') discount = money(subtotal * (num(form.discount_value) / 100));
    else if (form.discount_type === 'amount') discount = money(num(form.discount_value));
    discount = Math.min(Math.max(discount, 0), subtotal);

    const taxable = money(subtotal - discount);
    const rate = form.gst_mode === 'none' ? 0 : Math.max(0, num(form.gst_rate));

    let gst = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    if (form.gst_mode === 'gst') {
      gst = money((taxable * rate) / 100);
    } else if (form.gst_mode === 'cgst_sgst') {
      cgst = money((taxable * rate) / 200);
      sgst = cgst;
    } else if (form.gst_mode === 'igst') {
      igst = money((taxable * rate) / 100);
    }

    const shipping = money(num(form.shipping_amount));
    const before = money(taxable + gst + cgst + sgst + igst + shipping);
    const rounded = form.round_off_enabled ? Math.round(before) : before;

    return {
      subtotal, discount, taxable, rate, gst, cgst, sgst, igst, shipping,
      round_off: money(rounded - before),
      total: money(rounded)
    };
  }

  function totalsPanel(form, items, columns) {
    const t = computeTotals(form, items, columns);
    const rows = [];
    rows.push(['Subtotal', fmt.money(t.subtotal)]);
    if (t.discount > 0) {
      rows.push([form.discount_type === 'percent'
        ? 'Discount (' + fmt.number(form.discount_value, 2).replace(/\.00$/, '') + '%)'
        : 'Discount', '- ' + fmt.money(t.discount)]);
      rows.push(['Taxable value', fmt.money(t.taxable)]);
    }
    if (t.gst > 0) {
      rows.push(['GST @ ' + fmt.number(t.rate, 2).replace(/\.00$/, '') + '%', fmt.money(t.gst)]);
    }
    if (t.cgst > 0) {
      rows.push(['CGST @ ' + fmt.number(t.rate / 2, 2).replace(/\.00$/, '') + '%', fmt.money(t.cgst)]);
      rows.push(['SGST @ ' + fmt.number(t.rate / 2, 2).replace(/\.00$/, '') + '%', fmt.money(t.sgst)]);
    }
    if (t.igst > 0) {
      rows.push(['IGST @ ' + fmt.number(t.rate, 2).replace(/\.00$/, '') + '%', fmt.money(t.igst)]);
    }
    if (t.shipping > 0) rows.push(['Delivery / shipping', fmt.money(t.shipping)]);
    if (t.round_off !== 0) {
      rows.push(['Round off', (t.round_off < 0 ? '- ' : '+ ') + fmt.money(Math.abs(t.round_off))]);
    }

    return '<div class="totals-panel">' +
      rows.map((row) =>
        '<div class="row' + (/^(Taxable|Round)/.test(row[0]) ? ' muted' : '') + '">' +
        '<span>' + esc(row[0]) + '</span><span>' + row[1] + '</span></div>').join('') +
      '<div class="row grand"><span>Total</span><span>' + fmt.money(t.total) + '</span></div>' +
      '</div>';
  }

  // =========================================================================
  // Invoice editor
  // =========================================================================

  async function editor(ctx, opts) {
    const isEdit = Boolean(opts.id);
    let invoice;
    let items;
    let defaultBank = '';

    if (isEdit) {
      const loaded = await apiSafe('invoices:get', { id: opts.id });
      if (!loaded) return;
      invoice = loaded.invoice;
      items = loaded.items.length ? loaded.items : [blankItem()];
      invoice.round_off_enabled = true;
      defaultBank = loaded.defaultBankDetails || '';
      if (num(invoice.amount_paid) > 0) {
        toast('This invoice already has payments recorded',
          'info', 'Changing the total will change the balance due.');
      }
    } else {
      const draft = await apiSafe('invoices:newDraft', {
        clientId: opts.clientId || undefined,
        projectId: opts.projectId || undefined,
        includeProjectExpenses: false
      });
      if (!draft) return;
      invoice = draft.invoice;
      items = draft.items.length ? draft.items : [blankItem()];
      defaultBank = draft.defaultBankDetails || '';
    }

    // Which columns this invoice prints. Changing them re-renders the table.
    const columns = readColumns(invoice.column_config);

    const projects = await api('projects:options',
      invoice.client_id ? { clientId: invoice.client_id } : {});

    const handle = modal({
      title: isEdit ? 'Edit invoice ' + invoice.invoice_number : 'New invoice',
      sub: isEdit ? (invoice.bill_to_name || '') : 'Build the bill, preview it, then save',
      size: 'wide',
      lockBackdrop: true,
      body:
        '<div class="tabs">' +
          '<button data-pane="details" class="active">Invoice details</button>' +
          '<button data-pane="preview">Preview the PDF</button>' +
        '</div>' +
        '<div id="pane-details">' + detailsPane(invoice, items, projects, defaultBank) + '</div>' +
        '<div id="pane-preview" class="hidden">' +
          '<div class="preview-pane" style="height:calc(100vh - 290px);border-left:0">' +
            '<div class="preview-head">' + icon('eye', 14) +
              '<span>Exactly what the client will receive</span>' +
              '<span class="spacer"></span>' +
              '<span class="tiny" id="preview-note"></span>' +
            '</div>' +
            '<iframe class="preview-frame" id="preview-frame" title="Invoice preview"></iframe>' +
          '</div>' +
        '</div>',
      footer:
        '<button class="btn secondary" data-close>Cancel</button>' +
        '<span class="spacer"></span>' +
        '<span class="tiny faint" id="inv-total-hint"></span>' +
        (isEdit
          ? '<button class="btn" data-save="save">' + icon('check', 15) + 'Save changes</button>'
          : '<button class="btn secondary" data-save="draft">Save as draft</button>' +
            '<button class="btn" data-save="send">' + icon('check', 15) +
            'Save &amp; mark sent</button>')
    });

    const body = handle.body;
    const itemsHost = body.querySelector('#items-host');
    const togglesHost = body.querySelector('#col-toggles');

    /** Pull the current line items out of the DOM, whatever columns are shown. */
    const readItems = () => Array.from(body.querySelectorAll('#items-body tr')).map((tr) => {
      const cell = (name) => {
        const input = tr.querySelector('[data-col="' + name + '"]');
        return input ? input.value : '';
      };
      const custom = {};
      tr.querySelectorAll('[data-custom]').forEach((input) => {
        custom[input.getAttribute('data-custom')] = input.value;
      });
      return {
        description: cell('description'),
        hsn_sac: cell('hsn_sac'),
        quantity: columns.quantity ? cell('quantity') : 1,
        unit: cell('unit'),
        rate: cell('rate'),
        custom_fields: custom
      };
    });

    const refreshTotals = () => {
      const form = readForm(body);
      const current = readItems();
      body.querySelector('#totals-host').innerHTML = totalsPanel(form, current, columns);
      const rows = body.querySelectorAll('#items-body tr');
      current.forEach((item, index) => {
        const cell = rows[index] && rows[index].querySelector('.c-amt');
        if (!cell) return;
        const quantity = columns.quantity ? num(item.quantity) : 1;
        cell.textContent = fmt.money(money(quantity * num(item.rate)));
      });
      const t = computeTotals(form, current, columns);
      handle.el.querySelector('#inv-total-hint').textContent = 'Total ' + fmt.money(t.total);
    };

    /** Redraw the table and the toggles, keeping whatever has been typed. */
    const rerenderItems = (list) => {
      itemsHost.innerHTML = itemsTable(list.length ? list : [blankItem()], columns);
      togglesHost.innerHTML = columnToggles(columns);
      refreshTotals();
    };

    rerenderItems(items);

    // Turning a built-in column on or off, and adding or removing a custom one.
    togglesHost.addEventListener('change', (event) => {
      const toggle = event.target.closest('[data-col-toggle]');
      if (!toggle) return;
      const current = readItems();
      columns[toggle.getAttribute('data-col-toggle')] = toggle.checked;
      rerenderItems(current);
    });

    togglesHost.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-col-remove]');
      if (remove) {
        const current = readItems();
        const id = remove.getAttribute('data-col-remove');
        columns.custom = columns.custom.filter((column) => column.id !== id);
        rerenderItems(current);
        return;
      }
      if (!event.target.closest('#add-column')) return;

      const ask = modal({
        title: 'Add a column',
        size: 'narrow',
        body:
          '<div class="field"><label>Column heading <span class="req">*</span></label>' +
            '<input type="text" data-field="label" maxlength="40" ' +
            'placeholder="e.g. Size, Colour, Finish"></div>' +
          '<p class="tiny faint" style="margin:0">It appears on the invoice between the ' +
          'item and the rate, and you fill it in per line.</p>',
        footer: '<button class="btn secondary" data-close>Cancel</button>' +
          '<span class="spacer"></span>' +
          '<button class="btn" data-add>' + icon('plus', 14) + 'Add column</button>'
      });
      ask.el.querySelector('[data-add]').addEventListener('click', () => {
        const label = String(readForm(ask.body).label || '').trim();
        if (!label) { ask.error('Give the column a heading.'); return; }
        const current = readItems();
        columns.custom.push({ id: 'c' + (Date.now() % 100000), label });
        ask.close();
        rerenderItems(current);
      });
    });

    // Any edit anywhere re-runs the arithmetic.
    body.addEventListener('input', refreshTotals);
    body.addEventListener('change', refreshTotals);

    // The 0 / 5 / 12 / 18 / 28 shortcuts under the GST field.
    body.querySelectorAll('[data-rate]').forEach((button) => {
      button.addEventListener('click', () => {
        const rate = Number(button.getAttribute('data-rate'));
        const modeSelect = body.querySelector('[data-field="gst_mode"]');
        body.querySelector('[data-field="gst_rate"]').value = rate;
        if (rate === 0) {
          modeSelect.value = 'none';
        } else if (modeSelect.value === 'none') {
          // A single combined GST line is the normal case for commercial work.
          modeSelect.value = 'gst';
        }
        refreshTotals();
      });
    });

    itemsHost.addEventListener('click', (event) => {
      if (event.target.closest('#add-item')) {
        const current = readItems();
        current.push(blankItem());
        rerenderItems(current);
        const inputs = body.querySelectorAll('#items-body [data-col="description"]');
        if (inputs.length) inputs[inputs.length - 1].focus();
        return;
      }
      const button = event.target.closest('[data-remove-item]');
      if (!button) return;
      const current = readItems();
      if (current.length === 1) { rerenderItems([blankItem()]); return; }
      current.splice(Number(button.getAttribute('data-remove-item')), 1);
      rerenderItems(current);
    });

    // Choosing a client refreshes the project list and the frozen address block.
    const clientSelect = body.querySelector('[data-field="client_id"]');
    clientSelect.addEventListener('change', async () => {
      const list = await api('projects:options',
        clientSelect.value ? { clientId: clientSelect.value } : {});
      body.querySelector('[data-field="project_id"]').innerHTML =
        projectOptions(list, '');

      if (!clientSelect.value) return;
      const fresh = await apiSafe('invoices:newDraft', { clientId: clientSelect.value });
      if (!fresh) return;
      body.querySelector('[data-field="bill_to_name"]').value = fresh.invoice.bill_to_name || '';
      body.querySelector('[data-field="bill_to_address"]').value = fresh.invoice.bill_to_address || '';
      body.querySelector('[data-field="bill_to_gstin"]').value = fresh.invoice.bill_to_gstin || '';
      body.querySelector('[data-field="place_of_supply"]').value = fresh.invoice.place_of_supply || '';
      body.querySelector('[data-field="gst_mode"]').value = fresh.invoice.gst_mode;
      refreshTotals();
      toast('Billing details filled in from the client record', 'info');
    });

    // Choosing a project drops its title and amount into the first empty line.
    const projectSelect = body.querySelector('[data-field="project_id"]');
    projectSelect.addEventListener('change', () => {
      const option = projectSelect.selectedOptions[0];
      if (!option || !option.value) return;
      const current = readItems();
      const target = current.findIndex((item) => !String(item.description || '').trim());
      const line = {
        description: option.dataset.title || '',
        hsn_sac: '', quantity: 1, unit: '', rate: option.dataset.amount || 0,
        custom_fields: {}
      };
      if (target >= 0) current[target] = line;
      else current.push(line);
      rerenderItems(current);
      if (option.dataset.client && !clientSelect.value) {
        clientSelect.value = option.dataset.client;
        clientSelect.dispatchEvent(new Event('change'));
      }
    });

    // Tabs: details <-> live preview
    handle.el.querySelectorAll('[data-pane]').forEach((button) => {
      button.addEventListener('click', async () => {
        handle.el.querySelectorAll('[data-pane]').forEach((other) =>
          other.classList.toggle('active', other === button));
        const pane = button.getAttribute('data-pane');
        body.querySelector('#pane-details').classList.toggle('hidden', pane !== 'details');
        body.querySelector('#pane-preview').classList.toggle('hidden', pane !== 'preview');
        if (pane === 'preview') await renderPreview();
      });
    });

    async function renderPreview() {
      const note = body.querySelector('#preview-note');
      note.textContent = 'Rendering…';
      const form = readForm(body);
      const result = await apiSafe('invoices:previewDraft', Object.assign({}, form, {
        items: readItems(),
        columns,
        project_title: projectSelect.selectedOptions[0]
          ? projectSelect.selectedOptions[0].dataset.title : ''
      }));
      if (!result) { note.textContent = 'Preview failed'; return; }
      writeFrame(body.querySelector('#preview-frame'), result.html);
      note.textContent = 'A4 · updates when you switch back to this tab';
    }

    const save = async (mode, button) => {
      const form = readForm(body);
      const list = readItems().filter((item) => String(item.description || '').trim());
      if (!list.length) { handle.error('Add at least one line item with a description.'); return; }
      if (!String(form.bill_to_name || '').trim()) {
        handle.error('Enter who the invoice is for.');
        return;
      }

      await window.UI.busy(button, async () => {
        try {
          const payload = Object.assign({}, form, {
            id: opts.id || null,
            items: list,
            columns,
            status: mode === 'send' ? 'sent' : (isEdit ? undefined : 'draft')
          });
          const result = await api('invoices:save', payload);
          handle.close();
          toast('Invoice ' + result.invoice_number + ' saved', 'success',
            fmt.money(result.total));
          await load(ctx);
          viewer(ctx, result.id);
        } catch (err) {
          handle.error(err.message);
        }
      });
    };

    handle.el.querySelectorAll('[data-save]').forEach((button) => {
      button.addEventListener('click', () => save(button.getAttribute('data-save'), button));
    });
  }

  function blankItem() {
    return { description: '', hsn_sac: '', quantity: 1, unit: '', rate: '', custom_fields: {} };
  }

  function detailsPane(invoice, items, projects, defaultBank) {
    const currency = window.App.settings.currency_symbol || '₹';

    return '<div class="grid sidebar-right" style="gap:18px;align-items:start">' +
      // ---- left: the form -------------------------------------------------
      '<div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Invoice number <span class="req">*</span></label>' +
            '<input type="text" class="mono" data-field="invoice_number" value="' +
            esc(invoice.invoice_number) + '"></div>' +
          '<div class="field"><label>Invoice date <span class="req">*</span></label>' +
            '<input type="date" data-field="invoice_date" value="' +
            esc(invoice.invoice_date) + '"></div>' +
          '<div class="field"><label>Payment due by</label>' +
            '<input type="date" data-field="due_date" value="' +
            esc(invoice.due_date || '') + '"></div>' +
        '</div>' +

        '<div class="field-row">' +
          '<div class="field"><label>Client</label><select data-field="client_id">' +
            options(clients, {
              selected: invoice.client_id,
              blank: '— one-off customer —',
              label: (c) => c.company || c.name
            }) + '</select></div>' +
          '<div class="field"><label>Against project</label>' +
            '<select data-field="project_id">' +
            projectOptions(projects, invoice.project_id) + '</select></div>' +
        '</div>' +

        '<hr class="divider">' +
        '<div class="section-title">Billed to — printed on the invoice</div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Name / company <span class="req">*</span></label>' +
            '<input type="text" data-field="bill_to_name" value="' +
            esc(invoice.bill_to_name || '') + '"></div>' +
          '<div class="field"><label>Their GSTIN</label>' +
            '<input type="text" class="mono" data-field="bill_to_gstin" value="' +
            esc(invoice.bill_to_gstin || '') + '" spellcheck="false"></div>' +
        '</div>' +
        '<div class="field"><label>Their address</label>' +
          '<textarea data-field="bill_to_address" rows="3">' +
          esc(invoice.bill_to_address || '') + '</textarea>' +
          '<div class="help">Frozen onto this invoice, so editing the client later never ' +
          'changes a bill you have already sent.</div></div>' +

        '<hr class="divider">' +
        '<div class="flex between mb8">' +
          '<div class="section-title" style="margin:0">What you are billing for</div>' +
          '<div class="col-toggles" id="col-toggles"></div>' +
        '</div>' +
        '<div id="items-host"></div>' +

        '<hr class="divider">' +
        '<div class="section-title">Notes, payment details and terms</div>' +
        '<div class="field"><label>Notes</label>' +
          '<textarea data-field="notes" rows="2" placeholder="e.g. Job completed on 2 Oct, ' +
          'delivered to your office">' + esc(invoice.notes || '') + '</textarea>' +
          '<div class="help">Printed just above the payment details.</div></div>' +
        '<div class="field"><label>Payment details</label>' +
          '<textarea data-field="bank_details" rows="4" class="mono" ' +
          'placeholder="Account Name: ...">' +
          esc(invoice.bank_details || defaultBank || '') + '</textarea>' +
          '<div class="help">Starts from Settings &rarr; Company profile, and you can ' +
          'change it for this one invoice. Clear it to leave payment details off ' +
          'the bill entirely.</div></div>' +
        '<div class="field"><label>Terms &amp; conditions</label>' +
          '<textarea data-field="terms" rows="4">' + esc(invoice.terms || '') + '</textarea></div>' +
      '</div>' +

      // ---- right: tax, totals -------------------------------------------
      '<div class="col" style="gap:14px;position:sticky;top:0">' +
        card({
          title: 'Tax',
          body:
            '<div class="field"><label>GST treatment</label>' +
              '<select data-field="gst_mode">' +
              enumOptions(GST_MODES, invoice.gst_mode) + '</select>' +
              '<div class="help">One combined GST line suits most commercial work. ' +
              'Use the split forms when the accountant on the other side wants CGST + SGST ' +
              '(same state) or IGST (another state).</div>' +
            '</div>' +
            '<div class="field-row">' +
              '<div class="field"><label>GST rate %</label>' +
                '<input type="number" step="0.01" min="0" max="100" class="num" ' +
                'data-field="gst_rate" value="' + esc(invoice.gst_rate || 0) + '"></div>' +
              '<div class="field"><label>Place of supply</label>' +
                '<input type="text" data-field="place_of_supply" value="' +
                esc(invoice.place_of_supply || '') + '"></div>' +
            '</div>' +
            '<div class="btn-row" style="margin-bottom:12px">' +
              [0, 5, 12, 18, 28].map((rate) =>
                '<button class="btn sm secondary" type="button" data-rate="' + rate + '">' +
                rate + '%</button>').join('') +
            '</div>' +
            '<hr class="divider">' +
            '<div class="field-row">' +
              '<div class="field"><label>Discount</label>' +
                '<select data-field="discount_type">' +
                enumOptions([['none', 'No discount'], ['percent', 'Percent'], ['amount', 'Flat amount']],
                  invoice.discount_type || 'none') + '</select></div>' +
              '<div class="field"><label>Value</label>' +
                '<input type="number" step="0.01" min="0" class="num" ' +
                'data-field="discount_value" value="' +
                esc(invoice.discount_value || 0) + '"></div>' +
            '</div>' +
            '<div class="field"><label>Delivery / shipping charge</label>' +
              '<div class="input-prefix"><span>' + esc(currency) + '</span>' +
              '<input type="number" step="0.01" min="0" class="num" ' +
              'data-field="shipping_amount" value="' +
              esc(invoice.shipping_amount || 0) + '"></div></div>' +
            '<label class="check"><input type="checkbox" data-field="round_off_enabled"' +
            (invoice.round_off_enabled === false ? '' : ' checked') +
            '><span>Round the total to the nearest rupee</span></label>'
        }) +
        '<div id="totals-host"></div>' +
        '<p class="tiny faint" style="margin:0;line-height:1.6">' +
        'Your logo, address and GSTIN come from Settings &rarr; Company profile.</p>' +
      '</div>' +
    '</div>';
  }

  /**
   * One line of the items table, built from whichever columns this invoice uses.
   *
   * Only the item, the rate and the amount are fixed. Quantity is on by default
   * but can be switched off for a flat-price bill; HSN/SAC and Unit are off
   * unless asked for, so the printed invoice never carries an empty column.
   */
  function itemRow(item, index, columns) {
    const custom = item.custom_fields && typeof item.custom_fields === 'object'
      ? item.custom_fields
      : (() => { try { return JSON.parse(item.custom_fields || '{}'); } catch { return {}; } })();

    const quantity = columns.quantity ? num(item.quantity) : 1;

    return '<tr>' +
      '<td class="c-desc"><textarea data-col="description" rows="1" ' +
        'placeholder="What are you billing for?">' + esc(item.description || '') +
        '</textarea></td>' +
      (columns.hsn
        ? '<td class="c-hsn"><input type="text" class="mono" data-col="hsn_sac" value="' +
          esc(item.hsn_sac || '') + '" spellcheck="false"></td>'
        : '') +
      columns.custom.map((column) =>
        '<td class="c-custom"><input type="text" data-custom="' + esc(column.id) +
        '" value="' + esc(custom[column.id] || '') + '"></td>').join('') +
      (columns.quantity
        ? '<td class="c-qty"><input type="number" step="0.001" min="0" class="num" ' +
          'data-col="quantity" value="' + esc(item.quantity === '' ? '' : item.quantity) +
          '"></td>'
        : '') +
      (columns.unit
        ? '<td class="c-unit"><input type="text" data-col="unit" value="' +
          esc(item.unit || '') + '" placeholder="pcs"></td>'
        : '') +
      '<td class="c-rate"><input type="number" step="0.01" min="0" class="num" ' +
        'data-col="rate" value="' + esc(item.rate === '' ? '' : item.rate) + '"></td>' +
      '<td class="c-amt">' + fmt.money(quantity * num(item.rate)) + '</td>' +
      '<td class="c-del"><button class="btn sm ghost" type="button" data-remove-item="' +
        index + '" title="Remove this line">' + icon('close', 13) + '</button></td>' +
      '</tr>';
  }

  /** The whole items table, header included, for the current column set. */
  function itemsTable(items, columns) {
    const headers = ['<th class="c-desc">Item / service</th>']
      .concat(columns.hsn ? ['<th class="c-hsn">HSN/SAC</th>'] : [])
      .concat(columns.custom.map((column) =>
        '<th class="c-custom">' + esc(column.label) + '</th>'))
      .concat(columns.quantity ? ['<th class="c-qty">Qty</th>'] : [])
      .concat(columns.unit ? ['<th class="c-unit">Unit</th>'] : [])
      .concat(['<th class="c-rate">Rate</th>', '<th class="c-amt">Amount</th>',
        '<th class="c-del"></th>']);

    return '<table class="items-table">' +
      '<thead><tr>' + headers.join('') + '</tr></thead>' +
      '<tbody id="items-body">' +
        items.map((item, index) => itemRow(item, index, columns)).join('') +
      '</tbody>' +
      '<tfoot><tr><td colspan="' + headers.length + '">' +
        '<button class="btn sm secondary" id="add-item" type="button">' +
        icon('plus', 13) + 'Add a line</button>' +
      '</td></tr></tfoot>' +
      '</table>';
  }

  /** The checkboxes and chips that decide which columns the table shows. */
  function columnToggles(columns) {
    const toggle = (key, label) =>
      '<label class="col-toggle"><input type="checkbox" data-col-toggle="' + key + '"' +
      (columns[key] ? ' checked' : '') + '><span>' + esc(label) + '</span></label>';

    return toggle('quantity', 'Qty') + toggle('hsn', 'HSN/SAC') + toggle('unit', 'Unit') +
      columns.custom.map((column) =>
        '<span class="col-chip">' + esc(column.label) +
        '<button type="button" data-col-remove="' + esc(column.id) +
        '" title="Remove this column">' + icon('close', 11) + '</button></span>').join('') +
      (columns.custom.length < 4
        ? '<button class="btn sm ghost" type="button" id="add-column">' +
          icon('plus', 12) + 'Column</button>'
        : '');
  }

  function projectOptions(projects, selected) {
    let html = '<option value="">— not linked to a project —</option>';
    (projects || []).forEach((project) => {
      html += '<option value="' + project.id + '"' +
        (String(project.id) === String(selected || '') ? ' selected' : '') +
        ' data-client="' + (project.client_id || '') + '"' +
        ' data-amount="' + num(project.amount) + '"' +
        ' data-title="' + esc(project.title) + '">' +
        esc(project.title) +
        (project.client_name ? ' — ' + esc(project.client_name) : '') +
        ' (' + fmt.money(project.amount) + ')</option>';
    });
    return html;
  }

  /**
   * Write a document into an iframe without a data: URL, so a big embedded logo
   * can never hit a URL length limit.
   */
  function writeFrame(frame, html) {
    const doc = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
  }

  // =========================================================================
  // Invoice viewer
  // =========================================================================

  async function viewer(ctx, id) {
    const data = await apiSafe('invoices:get', { id });
    if (!data) return;
    const invoice = data.invoice;
    const balance = money(num(invoice.total) - num(invoice.amount_paid));
    const canPay = balance > 0.009 && invoice.status !== 'cancelled';

    const handle = modal({
      title: 'Invoice ' + invoice.invoice_number,
      sub: (invoice.bill_to_name || '') + '  ·  ' + fmt.date(invoice.invoice_date),
      size: 'wide',
      body:
        '<div class="flex wrap mb14">' +
          statusBadge(INVOICE_STATUS, invoice.status) +
          badge(fmt.money(invoice.total) + ' total', 'solid') +
          (num(invoice.amount_paid) > 0 ? badge(fmt.money(invoice.amount_paid) + ' received', 'good') : '') +
          (canPay ? badge(fmt.money(balance) + ' due', 'bad') : '') +
          (invoice.gst_mode !== 'none'
            ? badge(({ gst: 'GST', igst: 'IGST', cgst_sgst: 'CGST+SGST' }[invoice.gst_mode] ||
              'GST') + ' ' + fmt.number(invoice.gst_rate, 0) + '%')
            : badge('No GST', 'quiet')) +
          (invoice.project_title ? badge(invoice.project_title) : '') +
        '</div>' +

        '<div class="grid sidebar-right" style="gap:16px;align-items:start">' +
          '<div class="preview-pane" style="height:calc(100vh - 330px);border:1px solid var(--line);' +
            'border-radius:6px;overflow:hidden">' +
            '<div class="preview-head">' + icon('file', 14) + '<span>The bill</span></div>' +
            '<iframe class="preview-frame" id="view-frame" title="Invoice"></iframe>' +
          '</div>' +
          '<div class="col" style="gap:14px">' +
            card({ title: 'Summary', body:
              '<dl class="kv">' +
                '<dt>Subtotal</dt><dd>' + fmt.money(invoice.subtotal) + '</dd>' +
                (num(invoice.discount_amount) > 0
                  ? '<dt>Discount</dt><dd>- ' + fmt.money(invoice.discount_amount) + '</dd>' : '') +
                (num(invoice.gst_amount) > 0
                  ? '<dt>GST</dt><dd>' + fmt.money(invoice.gst_amount) + '</dd>' : '') +
                (num(invoice.cgst_amount) > 0
                  ? '<dt>CGST</dt><dd>' + fmt.money(invoice.cgst_amount) + '</dd>' +
                    '<dt>SGST</dt><dd>' + fmt.money(invoice.sgst_amount) + '</dd>' : '') +
                (num(invoice.igst_amount) > 0
                  ? '<dt>IGST</dt><dd>' + fmt.money(invoice.igst_amount) + '</dd>' : '') +
                (num(invoice.shipping_amount) > 0
                  ? '<dt>Shipping</dt><dd>' + fmt.money(invoice.shipping_amount) + '</dd>' : '') +
                (num(invoice.round_off) !== 0
                  ? '<dt>Round off</dt><dd>' + fmt.money(invoice.round_off) + '</dd>' : '') +
                '<dt class="strong">Total</dt><dd class="strong">' + fmt.money(invoice.total) + '</dd>' +
                '<dt>Received</dt><dd>' + fmt.money(invoice.amount_paid) + '</dd>' +
                '<dt class="strong">Balance</dt><dd class="strong ' +
                  (balance > 0.009 ? 'neg' : 'pos') + '">' + fmt.money(balance) + '</dd>' +
                (invoice.due_date ? '<dt>Due by</dt><dd>' + fmt.date(invoice.due_date) + '</dd>' : '') +
              '</dl>' }) +
            card({ title: 'Payments', flush: true, body: table([
              { label: 'Date', render: (r) => fmt.dateShort(r.paid_on) },
              { label: 'Mode', render: (r) =>
                '<span class="small">' + esc(methodLabel(r.method)) + '</span>' +
                (r.reference ? '<div class="row-sub">' + esc(r.reference) + '</div>' : '') },
              { label: 'Amount', className: 'num strong', render: (r) => fmt.money(r.amount) },
              { label: '', className: 'actions', render: (r) =>
                '<button class="btn sm ghost" data-action="unpay" data-id="' + r.id +
                '" data-amount="' + r.amount + '" title="Remove this payment">' +
                icon('trash', 13) + '</button>' }
            ], { rows: data.payments, compact: true,
              empty: { icon: 'money', title: 'No payment yet',
                message: 'Record one when the client pays.' } }) }) +
            '<div class="btn-row">' +
              '<select id="status-select" style="flex:1 1 auto">' +
                enumOptions(STATUSES, invoice.status) + '</select>' +
              '<button class="btn secondary sm" data-action="setStatus">Update</button>' +
            '</div>' +
          '</div>' +
        '</div>',
      footer:
        '<button class="btn secondary" data-close>Close</button>' +
        '<button class="btn secondary" data-action="edit">' + icon('edit', 14) + 'Edit</button>' +
        '<button class="btn secondary" data-action="duplicate">' + icon('copy', 14) + 'Duplicate</button>' +
        '<button class="btn danger" data-action="remove">' + icon('trash', 14) + '</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn secondary" data-action="print">' + icon('print', 14) + 'Print</button>' +
        '<button class="btn secondary" data-action="pdf">' + icon('download', 14) + 'Save PDF</button>' +
        (canPay
          ? '<button class="btn" data-action="pay">' + icon('money', 15) + 'Record payment</button>'
          : '')
    });

    const preview = await apiSafe('invoices:previewHtml', { id });
    if (preview) writeFrame(handle.body.querySelector('#view-frame'), preview.html);

    bindActions(handle.el, {
      edit: () => { handle.close(); editor(ctx, { id }); },
      pay: () => { handle.close(); paymentDialog(ctx, id, invoice); },

      pdf: async (ds, button) => {
        await window.UI.busy(button, async () => {
          const result = await apiSafe('invoices:exportPdf', { id });
          if (result && !result.canceled) toast('PDF saved', 'success', result.path);
        });
      },

      print: async (ds, button) => {
        await window.UI.busy(button, async () => {
          await apiSafe('invoices:print', { id });
        });
      },

      duplicate: async () => {
        const result = await apiSafe('invoices:duplicate', { id });
        if (!result) return;
        handle.close();
        toast('Copied as ' + result.invoice_number, 'success');
        await load(ctx);
        editor(ctx, { id: result.id });
      },

      setStatus: async () => {
        const next = handle.el.querySelector('#status-select').value;
        if (next === invoice.status) return;
        try {
          await api('invoices:setStatus', { id, status: next });
          handle.close();
          toast('Status updated', 'success');
          load(ctx);
        } catch (err) {
          handle.error(err.message);
        }
      },

      unpay: async (ds) => {
        const ok = await confirm({
          title: 'Remove payment',
          message: 'Remove this payment of ' + fmt.money(ds.amount) + '?',
          detail: 'The matching entry in your Income ledger is removed too, so the books ' +
            'stay in agreement.',
          confirmLabel: 'Remove payment',
          danger: true
        });
        if (!ok) return;
        const result = await apiSafe('invoices:deletePayment', { id: Number(ds.id) });
        if (result) {
          handle.close();
          toast('Payment removed', 'success');
          await load(ctx);
          viewer(ctx, id);
        }
      },

      remove: async () => {
        const ok = await confirm({
          title: 'Delete invoice',
          message: 'Delete invoice ' + invoice.invoice_number + '?',
          detail: 'For your records it is usually better to set the status to Cancelled, ' +
            'which keeps the number in sequence.',
          confirmLabel: 'Delete invoice',
          danger: true
        });
        if (!ok) return;
        try {
          await api('invoices:delete', { id });
          handle.close();
          toast('Invoice deleted', 'success');
          load(ctx);
        } catch (err) {
          handle.error(err.message);
        }
      }
    });
  }

  // =========================================================================
  // Record a payment
  // =========================================================================

  async function paymentDialog(ctx, id, invoiceInfo) {
    let invoice = invoiceInfo;
    if (!invoice) {
      const loaded = await apiSafe('invoices:get', { id });
      if (!loaded) return;
      invoice = loaded.invoice;
    }
    const balance = money(num(invoice.total) - num(invoice.amount_paid));

    const handle = modal({
      title: 'Record a payment',
      sub: 'Invoice ' + invoice.invoice_number + '  ·  ' + fmt.money(balance) + ' due',
      size: 'narrow',
      body:
        '<div class="field"><label>Amount received <span class="req">*</span></label>' +
          '<div class="input-prefix"><span>' +
          esc(invoice.currency_symbol || window.App.settings.currency_symbol || '₹') +
          '</span><input type="number" step="0.01" min="0" class="num" data-field="amount" ' +
          'value="' + balance.toFixed(2) + '"></div>' +
          '<div class="help">Leave the full balance for a complete settlement, or reduce it ' +
          'for a part payment.</div></div>' +
        '<div class="field"><label>Received on</label>' +
          '<input type="date" data-field="paid_on" value="' + today() + '"></div>' +
        '<div class="field"><label>Payment mode</label><select data-field="method">' +
          enumOptions(PAYMENT_METHODS, 'bank_transfer') + '</select></div>' +
        '<div class="field"><label>Reference</label>' +
          '<input type="text" data-field="reference" placeholder="UTR, cheque no."></div>' +
        '<label class="check"><input type="checkbox" data-field="allowOverpay">' +
          '<span>Allow more than the balance<small>Only tick this if the client genuinely ' +
          'paid extra.</small></span></label>',
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
          await api('invoices:recordPayment', Object.assign({ invoice_id: id }, payload));
          handle.close();
          toast('Payment recorded', 'success',
            'Added to your Income ledger automatically.');
          await load(ctx);
        } catch (err) {
          handle.error(err.message);
        }
      });
    });
  }
})();
