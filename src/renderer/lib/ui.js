/**
 * UI toolkit for the renderer: IPC wrapper, formatting, toasts, modals, tables,
 * forms and the small hand-drawn SVG charts.
 *
 * Everything the pages need hangs off `window.UI`.
 */
(function () {
  'use strict';

  const icon = window.Icons.icon;

  // =========================================================================
  // IPC
  // =========================================================================

  /**
   * Call the main process. Resolves with the data, or throws an Error carrying
   * `.code`, so page code can use plain try/catch.
   */
  async function api(channel, payload) {
    const response = await window.api.call(channel, payload || {});
    if (!response || !response.ok) {
      const error = new Error(
        response && response.error ? response.error.message : 'Something went wrong.'
      );
      error.code = response && response.error ? response.error.code : 'ERROR';
      throw error;
    }
    return response.data;
  }

  /** Call and show a toast on failure instead of throwing. Returns null. */
  async function apiSafe(channel, payload) {
    try {
      return await api(channel, payload);
    } catch (err) {
      toast(err.message, 'error');
      return null;
    }
  }

  // =========================================================================
  // Escaping and formatting
  // =========================================================================

  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Indian digit grouping: 1234567.5 -> "12,34,567.50" */
  function groupIndian(amount, decimals) {
    const n = Number(amount);
    const value = Number.isFinite(n) ? n : 0;
    const dp = decimals === undefined ? 2 : decimals;
    const negative = value < 0;
    const fixed = Math.abs(value).toFixed(dp);
    const parts = fixed.split('.');
    const whole = parts[0];
    let grouped;
    if (whole.length <= 3) {
      grouped = whole;
    } else {
      grouped = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + whole.slice(-3);
    }
    return (negative ? '-' : '') + grouped + (parts[1] ? '.' + parts[1] : '');
  }

  let currencySymbol = '₹';
  function setCurrency(symbol) { currencySymbol = symbol || '₹'; }

  const fmt = {
    /** "₹12,34,567.50" */
    money(amount, decimals) {
      return currencySymbol + ' ' + groupIndian(amount, decimals);
    },
    /** "₹12,34,568" — for tiles where paise are noise. */
    moneyShort(amount) {
      return currencySymbol + ' ' + groupIndian(amount, 0);
    },
    /** Compact for chart axes: 1.2L, 45K */
    moneyCompact(amount) {
      const n = Math.abs(Number(amount) || 0);
      const sign = Number(amount) < 0 ? '-' : '';
      if (n >= 10000000) return sign + (n / 10000000).toFixed(n >= 100000000 ? 0 : 1) + 'Cr';
      if (n >= 100000) return sign + (n / 100000).toFixed(n >= 1000000 ? 0 : 1) + 'L';
      if (n >= 1000) return sign + Math.round(n / 1000) + 'K';
      return sign + String(Math.round(n));
    },
    number(value, decimals) { return groupIndian(value, decimals === undefined ? 0 : decimals); },

    /** "08 Oct 2026" */
    date(value) {
      if (!value) return '—';
      const d = parseDate(value);
      if (!d) return esc(value);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return String(d.getDate()).padStart(2, '0') + ' ' + months[d.getMonth()] +
        ' ' + d.getFullYear();
    },
    /** "08 Oct" — tight table columns */
    dateShort(value) {
      if (!value) return '—';
      const d = parseDate(value);
      if (!d) return esc(value);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return String(d.getDate()).padStart(2, '0') + ' ' + months[d.getMonth()];
    },
    /** "2026-10" -> "Oct 26" */
    monthLabel(value) {
      const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
      if (!match) return esc(value);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return months[Number(match[2]) - 1] + ' ' + match[1].slice(2);
    },
    /** "2026-10" -> "October 2026" */
    monthLong(value) {
      const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
      if (!match) return esc(value);
      const months = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
      return months[Number(match[2]) - 1] + ' ' + match[1];
    },
    /** "3 days ago", "just now" */
    relative(value) {
      const d = parseDate(value);
      if (!d) return '';
      const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
      if (seconds < 60) return 'just now';
      if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
      if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
      const days = Math.floor(seconds / 86400);
      if (days < 31) return days + (days === 1 ? ' day ago' : ' days ago');
      return fmt.date(d);
    },
    /** "in 4 days" / "3 days overdue" from a day count. */
    due(days) {
      if (days === null || days === undefined) return '';
      const n = Number(days);
      if (n === 0) return 'due today';
      if (n === 1) return 'due tomorrow';
      if (n > 0) return 'in ' + n + ' days';
      if (n === -1) return '1 day overdue';
      return Math.abs(n) + ' days overdue';
    },
    percent(value, decimals) {
      const n = Number(value) || 0;
      return n.toFixed(decimals === undefined ? 1 : decimals) + '%';
    },
    bytes(value) {
      const n = Number(value) || 0;
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
      return (n / 1024 / 1024).toFixed(1) + ' MB';
    },
    /** snake_case / enum -> "Snake case" */
    label(value) {
      return String(value || '').replace(/_/g, ' ')
        .replace(/^./, (c) => c.toUpperCase());
    }
  };

  function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const text = String(value);
    const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const d = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      : new Date(text);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /** `YYYY-MM-DD` for a Date (or today). */
  function toInputDate(value) {
    const d = value ? parseDate(value) : new Date();
    if (!d) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  }

  function today() { return toInputDate(new Date()); }

  function monthStart(offsetMonths) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + (offsetMonths || 0));
    return toInputDate(d);
  }

  function monthEnd(offsetMonths) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + (offsetMonths || 0) + 1);
    d.setDate(0);
    return toInputDate(d);
  }

  /** First day of the Indian financial year containing today. */
  function fyStart() {
    const d = new Date();
    const year = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
    return year + '-04-01';
  }

  function num(value, fallback) {
    const n = Number(String(value === undefined || value === null ? '' : value)
      .replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }

  function money(value) {
    return Math.round((num(value) + Number.EPSILON) * 100) / 100;
  }

  // =========================================================================
  // Toasts
  // =========================================================================

  function toast(message, type, detail) {
    const root = document.getElementById('toast-root');
    const node = document.createElement('div');
    node.className = 'toast' + (type ? ' ' + type : '');
    const glyph = type === 'error' ? 'alert' : (type === 'success' ? 'check' : 'info');
    node.innerHTML = icon(glyph, 16) +
      '<div class="toast-body"><strong>' + esc(message) + '</strong>' +
      (detail ? '<small>' + esc(detail) + '</small>' : '') + '</div>';
    root.appendChild(node);

    const remove = () => {
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 220);
    };
    node.addEventListener('click', remove);
    setTimeout(remove, type === 'error' ? 7000 : 3600);
  }

  // =========================================================================
  // Modals
  // =========================================================================

  const modalStack = [];

  /**
   * Open a modal.
   * @param {object} options
   *   title, sub, body (HTML string), size ('narrow'|''|'wide'),
   *   footer (HTML string), onMount(modalBody, modalApi), scroll (bool)
   * @returns {{close:Function, el:HTMLElement, body:HTMLElement, error:Function}}
   */
  function modal(options) {
    const root = document.getElementById('modal-root');
    const wrap = document.createElement('div');
    wrap.className = 'modal-layer';
    wrap.innerHTML =
      '<div class="modal-backdrop"></div>' +
      '<div class="modal ' + (options.size || '') + '" role="dialog" aria-modal="true">' +
        '<div class="modal-head">' +
          '<div><h2>' + esc(options.title || '') + '</h2>' +
          (options.sub ? '<div class="sub">' + esc(options.sub) + '</div>' : '') + '</div>' +
          '<span class="spacer"></span>' +
          '<button class="btn ghost icon" data-close title="Close">' + icon('close', 16) + '</button>' +
        '</div>' +
        '<div class="modal-error"></div>' +
        '<div class="modal-body"></div>' +
        (options.footer === null ? '' :
          '<div class="modal-foot">' + (options.footer || '') + '</div>') +
      '</div>';

    root.appendChild(wrap);
    root.classList.add('open');

    const bodyEl = wrap.querySelector('.modal-body');
    const errorEl = wrap.querySelector('.modal-error');
    bodyEl.innerHTML = options.body || '';

    const handle = {
      el: wrap,
      body: bodyEl,
      /** Show an inline error strip inside the modal. */
      error(message) {
        if (!message) {
          errorEl.classList.remove('show');
          errorEl.textContent = '';
          return;
        }
        errorEl.textContent = message;
        errorEl.classList.add('show');
        errorEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      },
      close() {
        const index = modalStack.indexOf(handle);
        if (index >= 0) modalStack.splice(index, 1);
        wrap.remove();
        if (!root.children.length) root.classList.remove('open');
        document.removeEventListener('keydown', onKey);
      }
    };

    function onKey(event) {
      if (event.key !== 'Escape') return;
      if (modalStack[modalStack.length - 1] !== handle) return;
      event.stopPropagation();
      handle.close();
    }

    wrap.querySelectorAll('[data-close]').forEach((button) => {
      button.addEventListener('click', handle.close);
    });
    wrap.querySelector('.modal-backdrop').addEventListener('click', () => {
      if (options.lockBackdrop) return;
      handle.close();
    });
    document.addEventListener('keydown', onKey);
    modalStack.push(handle);

    if (typeof options.onMount === 'function') options.onMount(bodyEl, handle);

    // Focus the first useful control so keyboard entry just works.
    const first = bodyEl.querySelector('input:not([type=hidden]):not([disabled]), select, textarea');
    if (first) setTimeout(() => first.focus(), 40);

    return handle;
  }

  /** Native OS confirmation. Returns true when confirmed. */
  async function confirm(options) {
    const result = await api('app:confirm', options);
    return Boolean(result && result.confirmed);
  }

  function alertBox(options) { return api('app:message', options); }

  // =========================================================================
  // Forms
  // =========================================================================

  /**
   * Read every `[data-field]` control inside `container` into a plain object.
   * Checkboxes become 1/0, number inputs become numbers.
   */
  function readForm(container) {
    const out = {};
    container.querySelectorAll('[data-field]').forEach((input) => {
      const key = input.getAttribute('data-field');
      if (input.type === 'checkbox') {
        out[key] = input.checked ? 1 : 0;
      } else if (input.type === 'number' || input.classList.contains('num')) {
        out[key] = input.value === '' ? '' : num(input.value);
      } else {
        out[key] = input.value;
      }
    });
    return out;
  }

  /** Put values back into `[data-field]` controls. */
  function fillForm(container, values) {
    container.querySelectorAll('[data-field]').forEach((input) => {
      const key = input.getAttribute('data-field');
      if (!(key in (values || {}))) return;
      const value = values[key];
      if (input.type === 'checkbox') input.checked = Boolean(value) && value !== '0';
      else input.value = value === null || value === undefined ? '' : value;
    });
  }

  /** <option> list from rows, with an optional blank first entry. */
  function options(rows, config) {
    const cfg = config || {};
    const valueKey = cfg.value || 'id';
    const labelFn = cfg.label || ((row) => row.name);
    const selected = cfg.selected === undefined || cfg.selected === null
      ? '' : String(cfg.selected);
    let html = '';
    if (cfg.blank !== false) {
      html += '<option value=""' + (selected === '' ? ' selected' : '') + '>' +
        esc(cfg.blank || '— none —') + '</option>';
    }
    (rows || []).forEach((row) => {
      const value = String(row[valueKey]);
      html += '<option value="' + esc(value) + '"' +
        (value === selected ? ' selected' : '') + '>' + esc(labelFn(row)) + '</option>';
    });
    return html;
  }

  /** <option> list from a plain list of [value, label] pairs or strings. */
  function enumOptions(list, selected, blank) {
    let html = '';
    if (blank) html += '<option value="">' + esc(blank) + '</option>';
    (list || []).forEach((entry) => {
      const value = Array.isArray(entry) ? entry[0] : entry;
      const label = Array.isArray(entry) ? entry[1] : fmt.label(entry);
      html += '<option value="' + esc(value) + '"' +
        (String(value) === String(selected === undefined ? '' : selected) ? ' selected' : '') +
        '>' + esc(label) + '</option>';
    });
    return html;
  }

  const PAYMENT_METHODS = [
    ['upi', 'UPI'], ['cash', 'Cash'], ['bank_transfer', 'Bank transfer'],
    ['cheque', 'Cheque'], ['card', 'Card'], ['other', 'Other']
  ];

  function methodLabel(method) {
    const found = PAYMENT_METHODS.find((entry) => entry[0] === method);
    return found ? found[1] : fmt.label(method);
  }

  // =========================================================================
  // Badges
  // =========================================================================

  const PROJECT_STATUS = {
    planned: ['quiet', 'Planned'],
    in_progress: ['solid', 'In progress'],
    submitted: ['warn', 'Submitted'],
    completed: ['good', 'Completed'],
    on_hold: ['', 'On hold'],
    cancelled: ['quiet', 'Cancelled']
  };

  const PAYMENT_STATUS = {
    unpaid: ['bad', 'Unpaid'],
    partial: ['warn', 'Part paid'],
    paid: ['good', 'Paid']
  };

  const INVOICE_STATUS = {
    draft: ['quiet', 'Draft'],
    sent: ['', 'Sent'],
    partially_paid: ['warn', 'Part paid'],
    paid: ['good', 'Paid'],
    cancelled: ['quiet', 'Cancelled']
  };

  function badge(text, variant) {
    return '<span class="badge ' + (variant || '') + '">' + esc(text) + '</span>';
  }

  function statusBadge(map, value) {
    const entry = map[value] || ['', fmt.label(value)];
    return badge(entry[1], entry[0]);
  }

  // =========================================================================
  // Tables and layout fragments
  // =========================================================================

  /**
   * Render a table.
   * columns: [{ label, key?, render?(row), className?, width? }]
   * options: { rows, empty, footer, onRowClick, compact }
   */
  function table(columns, config) {
    const cfg = config || {};
    const rows = cfg.rows || [];
    if (!rows.length) {
      return emptyState(cfg.empty || {});
    }
    let html = '<div class="table-wrap"><table class="data' + (cfg.compact ? ' compact' : '') + '"><thead><tr>';
    columns.forEach((col) => {
      html += '<th' + (col.className ? ' class="' + col.className + '"' : '') +
        (col.width ? ' style="width:' + col.width + '"' : '') + '>' + esc(col.label) + '</th>';
    });
    html += '</tr></thead><tbody>';
    rows.forEach((row, index) => {
      html += '<tr' + (cfg.onRowClick ? ' class="clickable"' : '') +
        ' data-index="' + index + '"' +
        (row.id !== undefined ? ' data-id="' + esc(row.id) + '"' : '') + '>';
      columns.forEach((col) => {
        const content = col.render ? col.render(row, index) : esc(row[col.key]);
        html += '<td' + (col.className ? ' class="' + col.className + '"' : '') + '>' +
          (content === null || content === undefined ? '' : content) + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody>';
    if (cfg.footer) html += '<tfoot>' + cfg.footer + '</tfoot>';
    html += '</table></div>';
    return html;
  }

  /**
   * Wire row clicks after a table rendered by `table()` is in the DOM.
   * The handler is skipped when the click came from a button or a link.
   */
  function bindRows(container, rows, handler) {
    container.querySelectorAll('table.data tbody tr').forEach((tr) => {
      tr.addEventListener('click', (event) => {
        if (event.target.closest('button, a, input, select, label')) return;
        const index = Number(tr.getAttribute('data-index'));
        handler(rows[index], index, event);
      });
    });
  }

  /**
   * Delegate clicks on `[data-action]` buttons inside a container.
   *
   * Containers that survive navigation — `#topbar-actions` and `#view` above
   * all — would otherwise collect one listener per page visited, and a single
   * click would then fire the handlers of every page you had been to. So any
   * listener this function attached earlier to the same container is removed
   * first; binding twice replaces, it never stacks.
   */
  function bindActions(container, handlers) {
    if (container.__uiActionListener) {
      container.removeEventListener('click', container.__uiActionListener);
    }
    const listener = (event) => {
      const button = event.target.closest('[data-action]');
      if (!button || !container.contains(button)) return;
      const action = button.getAttribute('data-action');
      const handler = handlers[action];
      if (!handler) return;
      event.preventDefault();
      event.stopPropagation();
      handler(button.dataset, button, event);
    };
    container.__uiActionListener = listener;
    container.addEventListener('click', listener);
  }

  /**
   * Close every open modal. Called on navigation so a dialog can never outlive
   * the page that opened it.
   */
  function closeAllModals() {
    while (modalStack.length) modalStack[modalStack.length - 1].close();
    const root = document.getElementById('modal-root');
    if (root) {
      root.innerHTML = '';
      root.classList.remove('open');
    }
  }

  function emptyState(config) {
    const cfg = config || {};
    return '<div class="empty">' + icon(cfg.icon || 'inbox', 34) +
      '<h3>' + esc(cfg.title || 'Nothing here yet') + '</h3>' +
      '<p>' + esc(cfg.message || '') + '</p>' +
      (cfg.action
        ? '<button class="btn" data-action="' + esc(cfg.action) + '">' +
          icon('plus', 15) + esc(cfg.actionLabel || 'Add') + '</button>'
        : '') +
      '</div>';
  }

  function loading(rows) {
    let html = '<div class="loading-rows">';
    for (let index = 0; index < (rows || 6); index += 1) {
      html += '<div class="skeleton" style="width:' + (62 + ((index * 13) % 36)) + '%"></div>';
    }
    return html + '</div>';
  }

  function card(config) {
    const cfg = config || {};
    return '<section class="card' + (cfg.className ? ' ' + cfg.className : '') + '">' +
      (cfg.title || cfg.actions
        ? '<div class="card-head"><h2>' + esc(cfg.title || '') + '</h2>' +
          (cfg.hint ? '<span class="hint">' + esc(cfg.hint) + '</span>' : '') +
          '<span class="spacer"></span>' + (cfg.actions || '') + '</div>'
        : '') +
      '<div class="card-body' + (cfg.flush ? ' tight' : '') + '">' + (cfg.body || '') + '</div>' +
      (cfg.foot ? '<div class="card-foot">' + cfg.foot + '</div>' : '') +
      '</section>';
  }

  function stat(config) {
    const cfg = config || {};
    return '<div class="stat' + (cfg.accent ? ' accent' : '') + '">' +
      '<div class="stat-label">' + esc(cfg.label) + '</div>' +
      '<div class="stat-value' + (cfg.small ? ' sm' : '') + '">' + (cfg.value || '') + '</div>' +
      '<div class="stat-sub">' + (cfg.sub || '') + '</div>' +
      '</div>';
  }

  /** "+18.4% vs last month" style delta, or an em dash when there is no base. */
  function delta(current, previous, suffix) {
    const now = num(current);
    const before = num(previous);
    if (!before) {
      return '<span class="delta flat">' + (now ? 'new' : '—') + '</span>' +
        (suffix ? ' <span class="faint">' + esc(suffix) + '</span>' : '');
    }
    const change = ((now - before) / Math.abs(before)) * 100;
    const direction = change > 0.5 ? 'up' : (change < -0.5 ? 'down' : 'flat');
    const arrow = direction === 'up' ? '↑' : (direction === 'down' ? '↓' : '→');
    return '<span class="delta ' + direction + '">' + arrow + ' ' +
      Math.abs(change).toFixed(1) + '%</span>' +
      (suffix ? ' <span class="faint">' + esc(suffix) + '</span>' : '');
  }

  /** Horizontal bar breakdown list. items: [{label, value}] */
  function barList(items, config) {
    const cfg = config || {};
    const rows = (items || []).filter((item) => num(item.value) !== 0);
    if (!rows.length) {
      return '<p class="small faint center" style="padding:14px 0">' +
        esc(cfg.empty || 'Nothing recorded for this period.') + '</p>';
    }
    const max = Math.max.apply(null, rows.map((item) => Math.abs(num(item.value))));
    let html = '<div class="bars">';
    rows.slice(0, cfg.limit || 10).forEach((item) => {
      const width = max ? (Math.abs(num(item.value)) / max) * 100 : 0;
      html += '<div class="bar-row">' +
        '<span class="bar-label" title="' + esc(item.label) + '">' + esc(item.label) + '</span>' +
        '<span class="bar-value">' + (cfg.format ? cfg.format(item.value) : fmt.moneyShort(item.value)) + '</span>' +
        '<span class="bar-track"><span class="bar-fill' + (cfg.light ? ' light' : '') +
        '" style="width:' + width.toFixed(1) + '%"></span></span>' +
        '</div>';
    });
    return html + '</div>';
  }

  // =========================================================================
  // Charts (hand-rolled SVG, monochrome)
  // =========================================================================

  /**
   * Paired bar chart: income filled black, expenses hatched outline.
   * series: [{ month, income, expense }]
   */
  function barChart(series, config) {
    const cfg = config || {};
    const data = (series || []).slice(-(cfg.limit || 12));
    if (!data.length) {
      return '<p class="small faint center" style="padding:28px 0">' +
        'No figures recorded yet. Add an income entry or an expense to see the trend.</p>';
    }

    const width = 100;              // viewBox units; the SVG scales to its box
    const height = cfg.height || 34;
    const padLeft = 9;
    const padRight = 2;
    const padTop = 3;
    const padBottom = 6;
    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;

    const max = Math.max(
      1,
      Math.max.apply(null, data.map((row) => Math.max(num(row.income), num(row.expense))))
    );
    const niceMax = niceCeiling(max);
    const slot = plotWidth / data.length;
    const barWidth = Math.min(slot * 0.3, 3.4);
    const gap = barWidth * 0.18;

    const y = (value) => padTop + plotHeight - (num(value) / niceMax) * plotHeight;

    let html = '<div class="chart-legend">' +
      '<span><i class="fill"></i> Income</span>' +
      '<span><i class="hatch"></i> Expenses</span></div>' +
      '<svg class="chart" viewBox="0 0 ' + width + ' ' + height + '" ' +
      'preserveAspectRatio="none" style="height:' + (cfg.pixelHeight || 210) + 'px">' +
      '<defs><pattern id="hatch" width="1.4" height="1.4" patternTransform="rotate(45)" ' +
      'patternUnits="userSpaceOnUse">' +
      '<line x1="0" y1="0" x2="0" y2="1.4" stroke="#000" stroke-width=".45"/>' +
      '</pattern></defs>';

    // Horizontal grid lines with value labels.
    for (let step = 0; step <= 4; step += 1) {
      const value = (niceMax / 4) * step;
      const lineY = y(value);
      html += '<line class="grid-line" x1="' + padLeft + '" y1="' + lineY.toFixed(2) +
        '" x2="' + (width - padRight) + '" y2="' + lineY.toFixed(2) + '"/>';
      html += '<text class="label" x="' + (padLeft - 1) + '" y="' + (lineY + 1).toFixed(2) +
        '" text-anchor="end" style="font-size:2px">' + esc(fmt.moneyCompact(value)) + '</text>';
    }

    data.forEach((row, index) => {
      const centre = padLeft + slot * index + slot / 2;
      const incomeX = centre - barWidth - gap / 2;
      const expenseX = centre + gap / 2;
      const incomeY = y(row.income);
      const expenseY = y(row.expense);

      if (num(row.income) > 0) {
        html += '<rect class="bar-income" x="' + incomeX.toFixed(2) + '" y="' + incomeY.toFixed(2) +
          '" width="' + barWidth.toFixed(2) + '" height="' +
          Math.max(0.2, padTop + plotHeight - incomeY).toFixed(2) + '"/>';
      }
      if (num(row.expense) > 0) {
        html += '<rect class="bar-expense-hatch" x="' + expenseX.toFixed(2) + '" y="' +
          expenseY.toFixed(2) + '" width="' + barWidth.toFixed(2) + '" height="' +
          Math.max(0.2, padTop + plotHeight - expenseY).toFixed(2) + '"/>';
      }
      html += '<text class="label" x="' + centre.toFixed(2) + '" y="' + (height - 1.4) +
        '" text-anchor="middle" style="font-size:2.1px">' +
        esc(fmt.monthLabel(row.month)) + '</text>';
    });

    html += '<line class="axis" x1="' + padLeft + '" y1="' + (padTop + plotHeight) +
      '" x2="' + (width - padRight) + '" y2="' + (padTop + plotHeight) + '"/>';
    return html + '</svg>';
  }

  /** Round an axis maximum up to something readable. */
  function niceCeiling(value) {
    const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
    const scaled = value / magnitude;
    const step = scaled <= 1 ? 1 : (scaled <= 2 ? 2 : (scaled <= 2.5 ? 2.5 : (scaled <= 5 ? 5 : 10)));
    return step * magnitude;
  }

  // =========================================================================
  // Misc
  // =========================================================================

  function debounce(fn, wait) {
    let timer = null;
    return function debounced() {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(null, args), wait || 260);
    };
  }

  /** Give a button a short "working…" state so double clicks cannot happen. */
  async function busy(button, fn) {
    if (!button) return fn();
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = 'Working…';
    try {
      return await fn();
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(String(text)).then(
      () => toast('Copied to clipboard', 'success'),
      () => toast('Could not copy', 'error')
    );
  }

  window.UI = {
    api, apiSafe, esc, fmt, setCurrency, groupIndian,
    parseDate, toInputDate, today, monthStart, monthEnd, fyStart, num, money,
    toast, modal, confirm, alertBox,
    readForm, fillForm, options, enumOptions, PAYMENT_METHODS, methodLabel,
    badge, statusBadge, PROJECT_STATUS, PAYMENT_STATUS, INVOICE_STATUS,
    table, bindRows, bindActions, closeAllModals, emptyState, loading, card, stat, delta, barList,
    barChart, debounce, busy, copyToClipboard, icon
  };
})();
