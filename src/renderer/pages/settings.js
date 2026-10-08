/**
 * Settings: the company profile that prints on every invoice, invoice
 * numbering, the database connection, and the backup schedule.
 */
(function () {
  'use strict';

  window.Pages = window.Pages || {};

  const {
    api, apiSafe, esc, icon, fmt, card, table, toast, readForm, bindActions,
    confirm, enumOptions, num, badge
  } = window.UI;

  const state = { tab: 'company' };
  let settings = {};
  let info = {};

  window.Pages.settings = {
    title: 'Settings',
    crumb: 'Books',

    async render(ctx) {
      if (ctx.params.action === 'paths') state.tab = 'backups';

      const loaded = await api('settings:get');
      settings = loaded.settings || {};
      info = loaded.app || {};
      // The logo is deliberately left out of that response; the copy fetched
      // at start-up is still good, so reuse it rather than pulling a megabyte
      // of base64 back out of the database.
      if (settings.company_logo === undefined) {
        settings.company_logo = (window.App.settings || {}).company_logo || '';
      }

      ctx.el.innerHTML =
        '<div class="tabs">' +
          tab('company', 'Company profile') +
          tab('invoice', 'Invoice defaults') +
          tab('backups', 'Backups & data') +
          tab('database', 'Database') +
          tab('about', 'About') +
        '</div><div id="set-body"></div>';

      ctx.el.querySelectorAll('[data-tab]').forEach((button) => {
        button.addEventListener('click', () => {
          state.tab = button.getAttribute('data-tab');
          ctx.refresh();
        });
      });

      ctx.actions.innerHTML = '';
      await loadTab(ctx);
    }
  };

  /** Whatever this copy of the software is called. */
  function productName() {
    return String(value('app_display_name') || 'DashBill').trim() || 'DashBill';
  }

  function tab(id, label) {
    return '<button data-tab="' + id + '"' + (state.tab === id ? ' class="active"' : '') + '>' +
      esc(label) + '</button>';
  }

  async function loadTab(ctx) {
    if (state.tab === 'invoice') return invoiceTab(ctx);
    if (state.tab === 'backups') return backupsTab(ctx);
    if (state.tab === 'database') return databaseTab(ctx);
    if (state.tab === 'about') return aboutTab(ctx);
    return companyTab(ctx);
  }

  function value(key) {
    return settings[key] === undefined || settings[key] === null ? '' : settings[key];
  }

  function textField(label, key, config) {
    const cfg = config || {};
    return '<div class="field"><label>' + esc(label) + '</label>' +
      '<input type="' + (cfg.type || 'text') + '" data-field="' + key + '" value="' +
      esc(value(key)) + '"' +
      (cfg.placeholder ? ' placeholder="' + esc(cfg.placeholder) + '"' : '') +
      (cfg.mono ? ' class="mono" spellcheck="false"' : '') + '>' +
      (cfg.help ? '<div class="help">' + esc(cfg.help) + '</div>' : '') + '</div>';
  }

  function areaField(label, key, config) {
    const cfg = config || {};
    return '<div class="field"><label>' + esc(label) + '</label>' +
      '<textarea data-field="' + key + '" rows="' + (cfg.rows || 3) + '"' +
      (cfg.placeholder ? ' placeholder="' + esc(cfg.placeholder) + '"' : '') + '>' +
      esc(value(key)) + '</textarea>' +
      (cfg.help ? '<div class="help">' + esc(cfg.help) + '</div>' : '') + '</div>';
  }

  /** Save every [data-field] on the current tab back into app_settings. */
  async function save(ctx, host, button) {
    const payload = readForm(host);
    await window.UI.busy(button, async () => {
      const result = await apiSafe('settings:save', { settings: payload });
      if (!result) return;
      Object.assign(settings, payload);
      window.App.settings = Object.assign({}, window.App.settings, payload);
      window.UI.setCurrency(payload.currency_symbol || settings.currency_symbol);
      if (window.App.applyBranding) window.App.applyBranding(window.App.settings);
      toast('Settings saved', 'success');
    });
  }

  // =========================================================================
  // Company profile
  // =========================================================================

  async function companyTab(ctx) {
    const host = document.getElementById('set-body');
    const logo = value('company_logo');

    host.innerHTML =
      '<div class="banner">' + icon('info', 17) +
      '<div>Everything here prints on your invoices. Fill it in once and every bill ' +
      'you raise from now on carries it.</div></div>' +

      '<div class="grid sidebar-right" style="align-items:start">' +
        '<div class="col" style="gap:14px">' +
          card({ title: 'Business identity', body:
            '<div class="field-row">' +
              textField('Business name', 'company_name',
                { placeholder: 'Your business name' }) +
              textField('Tagline', 'company_tagline',
                { placeholder: 'Design · Print · Branding' }) +
            '</div>' +
            '<div class="field-row">' +
              textField('Phone', 'company_phone', { type: 'tel' }) +
              textField('Email', 'company_email', { type: 'email' }) +
              textField('Website', 'company_website') +
            '</div>' +
            '<div class="field-row">' +
              textField('GSTIN', 'company_gstin', { mono: true, placeholder: '15 characters' }) +
              textField('PAN', 'company_pan', { mono: true }) +
            '</div>' +
            textField('Proprietor / owner name', 'owner_name') +
            '<hr class="divider">' +
            textField('Name of this software', 'app_display_name',
              { placeholder: 'DashBill',
                help: 'Shown in the sidebar, the window title and the About box. ' +
                  'Rename it to whatever you like — this is your copy.' }) }) +

          card({ title: 'Address', body:
            textField('Address line 1', 'company_address_line1') +
            textField('Address line 2', 'company_address_line2') +
            '<div class="field-row">' +
              textField('City', 'company_city') +
              textField('State', 'company_state',
                { help: 'Used to decide CGST+SGST vs IGST' }) +
              textField('PIN code', 'company_pincode') +
            '</div>' +
            textField('Country', 'company_country') }) +

          card({ title: 'Bank details for the invoice', body:
            '<div class="field-row">' +
              textField('Account name', 'bank_account_name') +
              textField('Bank', 'bank_name') +
            '</div>' +
            '<div class="field-row">' +
              textField('Account number', 'bank_account_number', { mono: true }) +
              textField('IFSC', 'bank_ifsc', { mono: true }) +
            '</div>' +
            '<div class="field-row">' +
              textField('Branch', 'bank_branch') +
              textField('UPI ID', 'bank_upi', { mono: true }) +
            '</div>' +
            '<p class="tiny faint" style="margin:0">Leave any of these blank to keep them ' +
            'off the printed invoice.</p>' }) +
        '</div>' +

        '<div class="col" style="gap:14px">' +
          card({ title: 'Logo', body:
            '<div style="border:1px solid var(--line);border-radius:4px;padding:18px;' +
              'display:grid;place-items:center;background:var(--wash);min-height:150px">' +
              (logo
                ? '<img src="' + esc(logo) + '" alt="Logo" ' +
                  'style="max-width:180px;max-height:120px;object-fit:contain">'
                : '<div class="center faint small">' + icon('image', 30) +
                  '<div style="margin-top:8px">No logo yet</div></div>') +
            '</div>' +
            '<div class="btn-row mt14">' +
              '<button class="btn secondary" data-action="pickLogo">' + icon('upload', 14) +
              (logo ? 'Replace' : 'Choose a logo') + '</button>' +
              (logo
                ? '<button class="btn ghost" data-action="clearLogo">Remove</button>'
                : '') +
            '</div>' +
            '<p class="tiny faint mt8" style="line-height:1.6">PNG, JPG, SVG or WebP, under ' +
            '1 MB. A square mark around 600&times;600 prints crisply. It is stored inside ' +
            'the database, so it travels with your backups.</p>' }) +

          card({ title: 'Currency', body:
            '<div class="field"><label>Symbol</label>' +
              '<input type="text" data-field="currency_symbol" value="' +
              esc(value('currency_symbol') || '₹') + '" maxlength="4" ' +
              'style="width:90px;text-align:center;font-size:17px">' +
              '<div class="help">Used across the app and on every invoice.</div></div>' }) +
        '</div>' +
      '</div>' +

      '<div class="card-foot mt14" style="border-radius:6px;border:1px solid var(--line)">' +
        '<button class="btn" data-action="save">' + icon('save', 15) + 'Save company profile</button>' +
        '<span class="faint small">Changes apply to invoices you create from now on.</span>' +
      '</div>';

    bindActions(host, {
      save: (ds, button) => save(ctx, host, button),
      pickLogo: async (ds, button) => {
        await window.UI.busy(button, async () => {
          const result = await apiSafe('settings:pickLogo');
          if (!result || result.canceled) return;
          settings.company_logo = result.logo;
          window.App.settings = Object.assign({}, window.App.settings,
            { company_logo: result.logo });
          if (window.App.applyBranding) window.App.applyBranding(window.App.settings);
          toast('Logo updated', 'success', result.name + ' · ' + fmt.bytes(result.bytes));
          companyTab(ctx);
        });
      },
      clearLogo: async () => {
        const ok = await confirm({
          title: 'Remove logo',
          message: 'Remove the logo from your invoices?',
          confirmLabel: 'Remove'
        });
        if (!ok) return;
        await apiSafe('settings:clearLogo');
        settings.company_logo = '';
        window.App.settings = Object.assign({}, window.App.settings, { company_logo: '' });
        if (window.App.applyBranding) window.App.applyBranding(window.App.settings);
        toast('Logo removed', 'success');
        companyTab(ctx);
      }
    });
  }

  // =========================================================================
  // Invoice defaults
  // =========================================================================

  async function invoiceTab(ctx) {
    const host = document.getElementById('set-body');
    const preview = await apiSafe('invoices:nextNumber');

    host.innerHTML =
      '<div class="grid c2" style="align-items:start">' +
        card({ title: 'Invoice numbering', body:
          '<div class="field-row">' +
            textField('Prefix', 'invoice_prefix', { placeholder: 'AG' }) +
            textField('Next number', 'invoice_next_seq',
              { type: 'number', help: 'The counter for the {seq} part' }) +
            textField('Digits', 'invoice_seq_padding',
              { type: 'number', help: '3 gives 001' }) +
          '</div>' +
          textField('Format', 'invoice_number_format', { mono: true,
            help: 'Placeholders: {prefix} {fy} {yyyy} {yy} {mm} {seq}' }) +
          '<div class="banner good mt8" style="margin-bottom:0">' + icon('info', 16) +
          '<div>Your next invoice will be numbered <strong class="mono">' +
          esc(preview ? preview.number : '—') + '</strong>. ' +
          'A number already used is skipped automatically, and you can always type one ' +
          'in by hand on the invoice itself.</div></div>' }) +

        card({ title: 'Tax defaults', body:
          '<div class="field"><label>Default GST treatment</label>' +
            '<select data-field="invoice_default_gst_mode">' +
            enumOptions([['none', 'No GST'], ['gst', 'GST (one combined line)'],
              ['cgst_sgst', 'CGST + SGST'], ['igst', 'IGST']],
            value('invoice_default_gst_mode') || 'gst') + '</select>' +
            '<div class="help">One combined GST line is the usual choice for commercial ' +
            'work. Pick a split form instead and new invoices decide between CGST+SGST ' +
            'and IGST from the client’s state. With no GSTIN on your profile, new ' +
            'invoices carry no GST at all.</div></div>' +
          '<div class="field-row">' +
            textField('Default GST rate %', 'invoice_default_gst_rate', { type: 'number' }) +
            textField('Payment due in (days)', 'invoice_default_due_days', { type: 'number' }) +
          '</div>' +
          '<label class="check"><input type="checkbox" data-field="invoice_round_off"' +
          (value('invoice_round_off') !== '0' ? ' checked' : '') +
          '><span>Round invoice totals to the nearest rupee<small>A round-off line is ' +
          'shown on the bill whenever it applies.</small></span></label>' }) +
      '</div>' +

      '<div class="mt14">' +
        card({ title: 'Wording on the invoice', body:
          areaField('Default terms &amp; conditions', 'invoice_default_terms',
            { rows: 5, help: 'Copied onto each new invoice; you can edit it per invoice.' }) +
          '<div class="field-row">' +
            areaField('Footer note', 'invoice_footer_note', { rows: 2 }) +
            textField('Signature label', 'invoice_signature_label',
              { placeholder: 'For Your Business' }) +
          '</div>' }) +
      '</div>' +

      '<div class="card-foot mt14" style="border-radius:6px;border:1px solid var(--line)">' +
        '<button class="btn" data-action="save">' + icon('save', 15) + 'Save invoice defaults</button>' +
      '</div>';

    bindActions(host, { save: (ds, button) => save(ctx, host, button) });
  }

  // =========================================================================
  // Backups
  // =========================================================================

  async function backupsTab(ctx) {
    const host = document.getElementById('set-body');
    host.innerHTML = window.UI.loading(5);

    const [status, paths] = await Promise.all([
      api('backup:status'),
      api('backup:paths')
    ]);

    host.innerHTML =
      '<div class="banner' + (status.due ? ' warn' : ' good') + '">' +
      icon('shield', 17) +
      '<div>' + (status.due
        ? '<strong>A backup is due.</strong> '
        : '<strong>Your data is backed up.</strong> ') +
      (status.lastBackupAt
        ? 'Last copy ' + esc(fmt.relative(status.lastBackupAt)) + ' — ' +
          esc(fmt.date(status.lastBackupAt)) + '.'
        : 'No backup has been taken yet.') +
      ' Copies are written every ' + status.intervalDays + ' days, and again when you ' +
      'close the app.</div>' +
      '<span class="spacer"></span>' +
      '<button class="btn sm" data-action="run">Back up now</button></div>' +

      '<div class="grid c2 mb14" style="align-items:start">' +
        card({ title: 'Backup schedule', body:
          '<div class="field"><label>Backup folder</label>' +
            '<div class="flex" style="gap:8px">' +
              '<input type="text" id="b-folder" value="' + esc(status.folder) + '" readonly>' +
              '<button class="btn secondary" data-action="pickFolder">' + icon('folder', 14) +
              'Change</button>' +
            '</div>' +
            '<div class="help">Put this on a pen drive, an external disk or a synced ' +
            'folder. If this computer ever dies, these files are what bring your books ' +
            'back.</div></div>' +
          '<div class="field-row">' +
            '<div class="field"><label>Take a copy every</label>' +
              '<input type="number" min="1" max="365" class="num" id="b-interval" value="' +
              status.intervalDays + '"><div class="help">days</div></div>' +
            '<div class="field"><label>Keep the last</label>' +
              '<input type="number" min="1" max="500" class="num" id="b-keep" value="' +
              status.keepCopies + '"><div class="help">copies, then delete the oldest</div></div>' +
          '</div>' +
          '<label class="check"><input type="checkbox" id="b-exit"' +
          (status.backupOnExit ? ' checked' : '') +
          '><span>Also back up when I close the app<small>Recommended — it is the ' +
          'cheapest insurance there is.</small></span></label>' +
          '<div class="btn-row mt14">' +
            '<button class="btn" data-action="saveSchedule">' + icon('save', 15) + 'Save schedule</button>' +
            '<button class="btn secondary" data-action="openFolder">' + icon('folder', 14) +
            'Open folder</button>' +
          '</div>' }) +

        card({ title: 'Restore &amp; export', body:
          '<p class="small" style="margin:0 0 12px;line-height:1.65">A backup is an ' +
          'ordinary <code class="inline">.sql</code> file. You can restore it here, or on ' +
          'any other computer with MySQL using ' +
          '<code class="inline">mysql -u root -p anjoy_billings &lt; backup.sql</code>.</p>' +
          '<div class="btn-row">' +
            '<button class="btn secondary" data-action="saveAs">' + icon('download', 14) +
            'Save a copy elsewhere</button>' +
            '<button class="btn secondary" data-action="csv">' + icon('file', 14) +
            'Export CSV ledgers</button>' +
          '</div>' +
          '<hr class="divider">' +
          '<p class="small" style="margin:0 0 12px;line-height:1.65"><strong>Restoring ' +
          'replaces everything</strong> currently in the database. A safety copy of your ' +
          'present data is taken first, so it can be undone.</p>' +
          '<button class="btn danger" data-action="restore">' + icon('upload', 14) +
          'Restore from a backup file</button>' }) +
      '</div>' +

      card({
        title: 'Backup files',
        hint: status.files.length + ' file' + (status.files.length === 1 ? '' : 's') +
          ' · ' + fmt.bytes(status.totalBytes),
        flush: true,
        body: table([
          { label: 'File', render: (row) => '<span class="mono small">' + esc(row.name) + '</span>' },
          { label: 'Taken', render: (row) =>
            fmt.date(row.modified) +
            '<div class="row-sub">' + esc(fmt.relative(row.modified)) + '</div>' },
          { label: 'Size', className: 'num', render: (row) => fmt.bytes(row.bytes) },
          { label: '', className: 'actions', render: (row) =>
            '<button class="btn sm secondary" data-action="restoreFile" data-path="' +
            esc(row.path) + '" data-name="' + esc(row.name) + '">Restore</button>' +
            '<button class="btn sm ghost" data-action="reveal" data-path="' + esc(row.path) +
            '" title="Show in folder">' + icon('folder', 13) + '</button>' +
            '<button class="btn sm ghost" data-action="deleteFile" data-path="' + esc(row.path) +
            '" data-name="' + esc(row.name) + '" title="Delete">' + icon('trash', 13) + '</button>' }
        ], {
          rows: status.files,
          compact: true,
          empty: {
            icon: 'shield', title: 'No backups yet',
            message: 'Press "Back up now" to write your first copy.',
            action: 'run', actionLabel: 'Back up now'
          }
        })
      }) +

      '<div class="mt14">' + card({ title: 'Where everything lives', body:
        '<dl class="kv">' +
          '<dt>Database</dt><dd class="wrap mono small">' + esc(paths.database) + '</dd>' +
          '<dt>Backups</dt><dd class="wrap mono small">' + esc(paths.backupFolder) + '</dd>' +
          '<dt>Settings file</dt><dd class="wrap mono small">' + esc(paths.configFile) + '</dd>' +
          '<dt>App data</dt><dd class="wrap mono small">' + esc(paths.userData) + '</dd>' +
        '</dl>' +
        '<p class="tiny faint mt8" style="line-height:1.6">The only place this ' +
        'software sends anything is the database server you configured yourself. ' +
        'There is no vendor account, no telemetry and no third-party service ' +
        'involved.</p>' }) + '</div>';

    bindActions(host, {
      run: async (ds, button) => {
        await window.UI.busy(button, async () => {
          const result = await apiSafe('backup:run', { reason: 'manual' });
          if (!result) return;
          toast('Backup saved', 'success',
            fmt.bytes(result.bytes) + ' · ' + result.rows + ' rows');
          const fresh = await apiSafe('backup:status');
          if (fresh) window.App.setBackupStatus(fresh);
          backupsTab(ctx);
        });
      },

      saveSchedule: async (ds, button) => {
        await window.UI.busy(button, async () => {
          const result = await apiSafe('backup:settings', {
            intervalDays: num(document.getElementById('b-interval').value, 15),
            keepCopies: num(document.getElementById('b-keep').value, 24),
            backupOnExit: document.getElementById('b-exit').checked
          });
          if (result) { toast('Schedule saved', 'success'); backupsTab(ctx); }
        });
      },

      pickFolder: async () => {
        const result = await apiSafe('backup:pickFolder');
        if (result && !result.canceled) {
          toast('Backup folder changed', 'success', result.folder);
          backupsTab(ctx);
        }
      },

      openFolder: () => apiSafe('backup:openFolder'),

      saveAs: async (ds, button) => {
        await window.UI.busy(button, async () => {
          const result = await apiSafe('backup:saveAs');
          if (result && !result.canceled) toast('Copy saved', 'success', result.path);
        });
      },

      csv: async () => {
        const result = await apiSafe('backup:exportCsv', {});
        if (result && !result.canceled) {
          toast('CSV files written', 'success', result.files.join(', '));
        }
      },

      restore: async () => {
        const result = await apiSafe('backup:restore', {});
        if (result && !result.canceled) {
          toast('Database restored', 'success', result.restored);
          ctx.go('dashboard');
        }
      },

      restoreFile: async (ds) => {
        const ok = await confirm({
          title: 'Restore from backup',
          message: 'This replaces everything currently in the database.',
          detail: 'Every client, project, income entry, expense and invoice is ' +
            'replaced with the contents of ' + ds.name + '. A safety copy of your ' +
            'present data is taken first, so this can be undone.',
          confirmLabel: 'Replace my data',
          danger: true
        });
        if (!ok) return;
        const result = await apiSafe('backup:restore', { path: ds.path, confirmed: 1 });
        if (result && !result.canceled) {
          toast('Database restored from ' + ds.name, 'success');
          ctx.go('dashboard');
        }
      },

      reveal: (ds) => apiSafe('backup:revealFile', { path: ds.path }),

      deleteFile: async (ds) => {
        const ok = await confirm({
          title: 'Delete backup file',
          message: 'Delete ' + ds.name + '?',
          detail: 'It goes to the Recycle Bin.',
          confirmLabel: 'Delete',
          danger: true
        });
        if (!ok) return;
        const result = await apiSafe('backup:deleteFile', { path: ds.path });
        if (result) { toast('Backup deleted', 'success'); backupsTab(ctx); }
      }
    });
  }

  // =========================================================================
  // Database
  // =========================================================================

  async function databaseTab(ctx) {
    const host = document.getElementById('set-body');
    host.innerHTML = window.UI.loading(4);
    const status = await api('settings:dbStatus');
    const cfg = status.config || {};

    host.innerHTML =
      '<div class="banner' + (status.connected ? ' good' : ' bad') + '">' +
      icon('database', 17) +
      '<div>' + (status.connected
        ? '<strong>Connected.</strong> MySQL ' + esc(status.version) + ' · ' +
          esc(cfg.database) + ' on ' + esc(cfg.host) + ':' + esc(cfg.port)
        : '<strong>Not connected.</strong> ' +
          esc(status.error ? status.error.hint : 'Check the details below.')) +
      '</div></div>' +

      '<div class="grid c2" style="align-items:start">' +
        card({ title: 'Connection', body:
          '<div class="field"><label>Where the data lives</label>' +
            '<select data-db="mode" id="db-mode">' +
            enumOptions([
              ['tidb', 'TiDB Cloud or another hosted database'],
              ['mysql', 'MySQL on this computer or local network']
            ], cfg.mode || 'tidb') + '</select></div>' +

          '<div class="field"><label>Paste a connection string</label>' +
            '<div class="flex" style="gap:8px;align-items:flex-start">' +
              '<textarea id="db-conn" rows="2" class="mono" spellcheck="false" ' +
              'placeholder="mysql://user:password@host:4000/database"></textarea>' +
              '<button class="btn secondary" data-action="fill" style="flex:0 0 auto">Fill in</button>' +
            '</div>' +
            '<div class="help">Optional shortcut — it just fills in the fields below.</div>' +
          '</div>' +

          '<hr class="divider">' +
          '<div class="field-row">' +
            '<div class="field"><label>Host</label>' +
              '<input type="text" data-db="host" id="db-host" value="' + esc(cfg.host || '') +
              '" spellcheck="false"></div>' +
            '<div class="field" style="flex:0 0 110px"><label>Port</label>' +
              '<input type="number" data-db="port" id="db-port" value="' +
              esc(cfg.port || 4000) + '"></div>' +
          '</div>' +
          '<div class="field-row">' +
            '<div class="field"><label>User</label>' +
              '<input type="text" data-db="user" id="db-user" value="' + esc(cfg.user || '') +
              '" spellcheck="false"></div>' +
            '<div class="field"><label>Password</label>' +
              '<input type="password" data-db="password" id="db-password" placeholder="' +
              (cfg.password ? 'unchanged' : 'no password set') + '"></div>' +
          '</div>' +
          '<div class="field"><label>Database</label>' +
            '<input type="text" data-db="database" id="db-database" value="' +
            esc(cfg.database || '') + '" spellcheck="false">' +
            '<div class="help">Created automatically if it does not exist.</div></div>' +
          '<label class="check"><input type="checkbox" data-db="ssl" id="db-ssl"' +
          (cfg.ssl ? ' checked' : '') +
          '><span>Use a secure connection (TLS)<small>Required by TiDB Cloud and every ' +
          'other hosted database. Switched on automatically for those hosts.</small>' +
          '</span></label>' +
          '<div class="btn-row mt14">' +
            '<button class="btn" data-action="saveDb">' + icon('check', 15) +
            'Save &amp; connect</button>' +
            '<button class="btn secondary" data-action="testDb">Test connection</button>' +
          '</div>' +
          '<p class="tiny faint mt8" style="line-height:1.6">Leave the password blank to ' +
          'keep the one already saved. These details are stored in ' +
          '<code class="inline">config.json</code> in your app data folder on this ' +
          'computer only — they are never sent anywhere except to your own ' +
          'database server.</p>' }) +

        card({ title: 'What is in there', body: status.connected
          ? '<dl class="kv">' +
              '<dt>Clients</dt><dd>' + num(status.counts.clients) + '</dd>' +
              '<dt>Projects</dt><dd>' + num(status.counts.projects) + '</dd>' +
              '<dt>Income entries</dt><dd>' + num(status.counts.incomes) + '</dd>' +
              '<dt>Expense entries</dt><dd>' + num(status.counts.expenses) + '</dd>' +
              '<dt>Invoices</dt><dd>' + num(status.counts.invoices) + '</dd>' +
              '<dt>Tables</dt><dd>' + num(status.size.tables) + '</dd>' +
              '<dt>Size</dt><dd>' + fmt.bytes(status.size.bytes) + '</dd>' +
              '<dt>Server</dt><dd class="wrap small">' + esc(status.version || '') + '</dd>' +
            '</dl>' +
            '<hr class="divider">' +
            '<p class="tiny faint" style="margin:0;line-height:1.6">' +
            (cfg.mode === 'mysql'
              ? 'MySQL keeps the actual files under its own data directory. Do not copy ' +
                'those by hand — use the backup files on the Backups tab, which are ' +
                'safe to copy anywhere.'
              : 'Your cluster is managed by your provider, who also keeps their own ' +
                'snapshots. Take the app’s own backups as well: they are plain SQL ' +
                'files you can restore onto any MySQL-compatible server, including one ' +
                'on your own machine.') + '</p>'
          : '<p class="small faint" style="margin:0">Connect first to see the contents.</p>' }) +
      '</div>';

    const readDb = () => {
      const out = {};
      host.querySelectorAll('[data-db]').forEach((input) => {
        const key = input.getAttribute('data-db');
        // An untouched password field means "keep the one already saved".
        if (key === 'password' && input.value === '') return;
        out[key] = input.type === 'checkbox' ? (input.checked ? 1 : 0) : input.value;
      });
      return out;
    };

    // Switching between cloud and local flips the sensible port and TLS default.
    document.getElementById('db-mode').addEventListener('change', (event) => {
      const isCloud = event.target.value === 'tidb';
      const portEl = document.getElementById('db-port');
      if (!portEl.value || Number(portEl.value) === (isCloud ? 3306 : 4000)) {
        portEl.value = isCloud ? 4000 : 3306;
      }
      document.getElementById('db-ssl').checked = isCloud;
    });

    bindActions(host, {
      fill: async () => {
        const result = await apiSafe('settings:parseConnectionString',
          { text: document.getElementById('db-conn').value });
        if (!result) return;
        if (!result.ok) { toast('Could not read that string', 'error', result.error.message); return; }
        const v = result.value;
        document.getElementById('db-mode').value = v.mode;
        document.getElementById('db-host').value = v.host;
        document.getElementById('db-port').value = v.port;
        document.getElementById('db-user').value = v.user;
        document.getElementById('db-password').value = v.password;
        document.getElementById('db-database').value = v.database;
        document.getElementById('db-ssl').checked = Boolean(v.ssl);
        toast('Fields filled in', 'success', 'Press Save & connect to apply.');
      },

      testDb: async (ds, button) => {
        await window.UI.busy(button, async () => {
          const result = await apiSafe('settings:testDb', readDb());
          if (!result) return;
          if (result.ok) toast('Connection works', 'success', result.version);
          else toast('Could not connect', 'error', result.error.hint);
        });
      },

      saveDb: async (ds, button) => {
        await window.UI.busy(button, async () => {
          const result = await apiSafe('settings:saveDb', readDb());
          if (!result) return;
          if (!result.ok) { toast('Could not connect', 'error', result.error.hint); return; }
          toast('Connected', 'success', result.version);
          databaseTab(ctx);
        });
      }
    });
  }

  // =========================================================================
  // About
  // =========================================================================

  async function aboutTab(ctx) {
    const host = document.getElementById('set-body');
    const boot = window.App.bootstrap || {};

    host.innerHTML =
      '<div class="grid c2" style="align-items:start">' +
        card({ title: productName(), body:
          '<div class="flex top" style="gap:16px">' +
            '<div class="gate-badge" style="margin:0;width:54px;height:54px;font-size:19px">AG</div>' +
            '<div>' +
              '<h3 style="margin:0 0 4px;font-size:16px">' + esc(productName()) + ' ' +
              esc(info.version || '') + '</h3>' +
              '<p class="small muted" style="margin:0;line-height:1.6">Budget, project ' +
              'and GST invoicing software' +
              (value('company_name') ? ', set up for ' + esc(value('company_name')) : '') +
              '.</p>' +
            '</div>' +
          '</div>' +
          '<hr class="divider">' +
          '<dl class="kv">' +
            '<dt>Software</dt><dd>' + esc(productName()) + '</dd>' +
            '<dt>Set up for</dt><dd>' +
              esc(value('company_name') || 'not set yet') + '</dd>' +
            '<dt>Author</dt><dd>Samuel Fernandes</dd>' +
            '<dt>Version</dt><dd>' + esc(info.version || '1.0.0') + '</dd>' +
            '<dt>Database</dt><dd>' +
            esc((boot.database || {}).mode === 'mysql'
              ? 'MySQL on this computer' : 'TiDB Cloud') + '</dd>' +
            '<dt>Electron</dt><dd>' + esc(info.electron || '') + '</dd>' +
            '<dt>Node</dt><dd>' + esc(info.node || '') + '</dd>' +
          '</dl>' }) +

        card({ title: 'How your data is kept', body:
          '<ul class="small" style="margin:0;padding-left:18px;line-height:1.85">' +
            '<li>Everything is stored in the database you chose during setup — ' +
            (((boot.database || {}).mode === 'mysql')
              ? 'a MySQL server on this computer, so nothing leaves the machine.'
              : 'your own TiDB Cloud cluster, reached over an encrypted (TLS) ' +
                'connection.') + '</li>' +
            '<li>No vendor account, no telemetry, no third-party service. The app ' +
            'talks to your database and to nothing else.</li>' +
            '<li>A full <code class="inline">.sql</code> backup is written every ' +
            esc(String((boot.backup || {}).intervalDays || 15)) + ' days and again when ' +
            'you close the app.</li>' +
            '<li>Keep the backup folder on a pen drive or an external disk as well. That ' +
            'is what protects you if this machine fails.</li>' +
            '<li>Invoices are rendered to PDF locally by the app itself.</li>' +
          '</ul>' +
          '<hr class="divider">' +
          '<div class="btn-row">' +
            '<button class="btn secondary" data-action="backups">' + icon('shield', 14) +
            'Backups &amp; data</button>' +
            '<button class="btn secondary" data-action="readme">' + icon('file', 14) +
            'Open the README</button>' +
          '</div>' }) +
      '</div>' +

      '<div class="mt14">' + card({ title: 'Keyboard shortcuts', body:
        '<div class="grid c3" style="gap:10px 24px">' +
          [['Ctrl+N', 'New invoice'], ['Ctrl+I', 'New income entry'],
            ['Ctrl+E', 'New expense'], ['Ctrl+P', 'New project'],
            ['Ctrl+Shift+C', 'New client'], ['Ctrl+B', 'Back up now'],
            ['Ctrl+,', 'Settings'], ['F5', 'Refresh the page'],
            ['Alt+1 … Alt+7', 'Jump between tabs']].map((pair) =>
            '<div class="flex between small"><code class="inline">' + esc(pair[0]) +
            '</code><span class="faint">' + esc(pair[1]) + '</span></div>').join('') +
        '</div>' }) + '</div>';

    bindActions(host, {
      backups: () => { state.tab = 'backups'; ctx.refresh(); },
      readme: async () => {
        const result = await window.api.call('app:openReadme');
        if (!result.ok) {
          toast('Could not open the README automatically', 'info',
            'Open README.md from the program folder.');
        }
      }
    });
  }
})();
