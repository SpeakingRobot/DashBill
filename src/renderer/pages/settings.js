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

  const state = { tab: 'company', forceNews: false };

  /** value, label, and the size of the "Aa" sample that shows it. */
  const ZOOMS = [
    [1, 'Normal', 15],
    [1.15, 'Large', 18],
    [1.3, 'Larger', 21],
    [1.5, 'Largest', 24]
  ];
  let zoomNow = 1;
  let settings = {};
  let info = {};

  window.Pages.settings = {
    title: 'Settings',
    crumb: 'Books',

    async render(ctx) {
      if (ctx.params.action === 'paths') state.tab = 'backups';
      if (ctx.params.action === 'updates') state.tab = 'updates';

      const loaded = await api('settings:get');
      settings = loaded.settings || {};
      info = loaded.app || {};
      // The logo is deliberately left out of that response; the copy fetched
      // at start-up is still good, so reuse it rather than pulling a megabyte
      // of base64 back out of the database.
      if (settings.company_logo === undefined) {
        settings.company_logo = (window.App.settings || {}).company_logo || '';
      }
      if (settings.invoice_signature_image === undefined) {
        settings.invoice_signature_image =
          (window.App.settings || {}).invoice_signature_image || '';
      }

      ctx.el.innerHTML =
        '<div class="tabs">' +
          tab('company', 'Company profile') +
          tab('invoice', 'Invoice defaults') +
          tab('backups', 'Backups & data') +
          tab('database', 'Database') +
          tab('updates', 'Updates & news') +
          tab('help', 'Help & tutorial') +
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
    if (state.tab === 'updates') return updatesTab(ctx);
    if (state.tab === 'help') return helpTab(ctx);
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
    const current = await apiSafe('app:getZoom');
    if (current) zoomNow = current.zoom;
    const logo = value('company_logo');
    const sign = value('invoice_signature_image');

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
          card({ title: 'Display size',
            hint: 'this screen only', body:
            '<p class="small" style="margin:0 0 12px;line-height:1.6">Makes ' +
            'everything in ' + esc(productName()) + ' bigger &mdash; text, ' +
            'buttons and spacing alike. It changes nothing on the rest of your ' +
            'computer, and nothing on your printed invoices.</p>' +
            '<div class="size-choice" id="size-choice">' +
              ZOOMS.map((z) =>
                '<button data-action="zoom" data-zoom="' + z[0] + '"' +
                (Math.abs(zoomNow - z[0]) < 0.02 ? ' class="active"' : '') + '>' +
                '<span style="font-size:' + z[2] + 'px">Aa</span>' +
                '<em>' + esc(z[1]) + '</em></button>').join('') +
            '</div>' +
            '<p class="tiny faint mt8" style="line-height:1.6">You can also ' +
            'press <strong>Ctrl</strong> and <strong>+</strong> at any time, or ' +
            '<strong>Ctrl</strong> and <strong>0</strong> to go back to ' +
            'normal.</p>' }) +

          card({ title: 'Logo', body:
            '<div class="image-drop">' +
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

          card({ title: 'Signature', body:
            '<div class="image-drop' + (sign ? ' checker' : '') + '">' +
              (sign
                ? '<img src="' + esc(sign) + '" alt="Signature" class="sign-sample">'
                : '<div class="center faint small">' + icon('edit', 26) +
                  '<div style="margin-top:8px">No signature yet</div></div>') +
            '</div>' +
            '<div class="btn-row mt14">' +
              '<button class="btn secondary" data-action="pickSignature">' +
              icon('upload', 14) + (sign ? 'Replace' : 'Upload signature') + '</button>' +
              (sign
                ? '<button class="btn ghost" data-action="clearSignature">Remove</button>'
                : '') +
            '</div>' +
            '<p class="tiny faint mt8" style="line-height:1.6">Prints on the signature ' +
            'line above <em>Authorised Signatory</em> on every invoice. Use a ' +
            '<strong>transparent PNG</strong> — sign on white paper, scan or photograph ' +
            'it, remove the background, and it will sit on the line instead of in a ' +
            'white box. Under 512 KB; about 600&times;200 is ideal.</p>' }) +

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
      zoom: async (ds) => {
        const result = await apiSafe('app:setZoom', { zoom: Number(ds.zoom) });
        if (!result) return;
        zoomNow = result.zoom;
        host.querySelectorAll('#size-choice button').forEach((b) => {
          b.classList.toggle('active',
            Math.abs(Number(b.getAttribute('data-zoom')) - zoomNow) < 0.02);
        });
        toast('Display size ' + Math.round(zoomNow * 100) + '%', 'success');
      },
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
      pickSignature: async (ds, button) => {
        await window.UI.busy(button, async () => {
          const result = await apiSafe('settings:pickSignature');
          if (!result || result.canceled) return;
          settings.invoice_signature_image = result.image;
          window.App.settings = Object.assign({}, window.App.settings,
            { invoice_signature_image: result.image });
          toast('Signature saved', 'success',
            result.transparent
              ? 'It will print on the signature line of every invoice.'
              : 'A JPG carries its background — a transparent PNG looks cleaner.');
          companyTab(ctx);
        });
      },
      clearSignature: async () => {
        const ok = await confirm({
          title: 'Remove signature',
          message: 'Remove the signature image from your invoices?',
          detail: 'The signature line and your name still print; only the image goes.',
          confirmLabel: 'Remove'
        });
        if (!ok) return;
        await apiSafe('settings:clearSignature');
        settings.invoice_signature_image = '';
        window.App.settings = Object.assign({}, window.App.settings,
          { invoice_signature_image: '' });
        toast('Signature removed', 'success');
        companyTab(ctx);
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
          '<code class="inline">mysql -u root -p dashbill &lt; backup.sql</code>.</p>' +
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
  // Updates & news
  //
  // A new version is published as a GitHub release; this screen finds it,
  // downloads it and runs the installer. Nothing of the user's is touched by
  // that: the books live in their database and the connection details in
  // their own profile folder, so only the program files are replaced.
  // =========================================================================

  /**
   * Render release notes without letting them become markup.
   *
   * Release bodies are Markdown written by whoever cut the release. They are
   * escaped first and only then given the lightest possible structure —
   * headings, bullets and paragraphs. Nothing in a release note can introduce
   * a tag, a link target or a script.
   */
  function notesHtml(body) {
    const lines = String(body || '').split(/\r?\n/);
    let html = '';
    let inList = false;
    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };

    lines.forEach((raw) => {
      const line = raw.trim();
      if (!line) { closeList(); return; }
      if (/^[-*+]\s+/.test(line)) {
        if (!inList) { html += '<ul class="notes-list">'; inList = true; }
        html += '<li>' + inline(line.replace(/^[-*+]\s+/, '')) + '</li>';
        return;
      }
      closeList();
      if (/^#{1,6}\s+/.test(line)) {
        html += '<p class="notes-head">' + inline(line.replace(/^#{1,6}\s+/, '')) + '</p>';
        return;
      }
      html += '<p>' + inline(line) + '</p>';
    });
    closeList();
    return html || '<p class="faint">No notes were written for this release.</p>';
  }

  /** Escape, then allow **bold** and `code` and nothing else. */
  function inline(value) {
    return esc(value)
      .replace(/\*\*([^*]{1,200})\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]{1,200})`/g, '<code class="inline">$1</code>');
  }

  function versionRow(label, value) {
    return '<div class="ver-row"><span>' + esc(label) + '</span><strong>' +
      esc(value) + '</strong></div>';
  }

  async function updatesTab(ctx) {
    const host = document.getElementById('set-body');
    host.innerHTML = window.UI.loading(4);

    const [status, feed] = await Promise.all([
      apiSafe('updates:state'),
      apiSafe('updates:news', { force: Boolean(state.forceNews) })
    ]);
    state.forceNews = false;
    drawUpdates(ctx, status || {}, feed || { releases: [], notices: [] });

    // Opening this screen counts as having read what is on it.
    if (feed && (feed.unread || 0) > 0) {
      await apiSafe('updates:markSeen', {
        version: (feed.newReleases || [])[0],
        noticeIds: feed.unreadNoticeIds || []
      });
      if (window.App.setNewsBadge) window.App.setNewsBadge(0);
    }
  }

  /** Redrawn on every push from the updater, so progress is live. */
  function drawUpdates(ctx, status, feed) {
    const host = document.getElementById('set-body');
    if (!host) return;
    const current = status.current || (info && info.version) || '';

    host.innerHTML =
      updateCard(status, current) +
      (feed.offline
        ? '<div class="banner mt14">' + icon('info', 17) +
          '<div><strong>No connection to GitHub just now.</strong> Release notes and ' +
          'messages will appear the next time you are online. Nothing else in the ' +
          'software needs it.</div></div>'
        : '') +
      noticesCard(feed) +
      releasesCard(feed, current);

    bindActions(host, {
      check: async (ds, button) => {
        await window.UI.busy(button, async () => {
          state.forceNews = true;
          const next = await apiSafe('updates:check', { force: 1 });
          if (!next) return;
          await updatesTab(ctx);
          toast(next.status === 'available'
            ? 'Version ' + next.version + ' is available'
            : 'You are on the latest version', 'success');
        });
      },
      download: async (ds, button) => {
        await window.UI.busy(button, async () => {
          const next = await apiSafe('updates:download');
          if (next) drawUpdates(ctx, next, feed);
        });
      },
      install: async () => {
        const ok = await confirm({
          title: 'Install the update',
          message: 'Close ' + productName() + ' and install version ' +
            (status.version || '') + '?',
          detail: 'Your books, your database connection and all your settings stay ' +
            'exactly as they are — only the program files are replaced. The software ' +
            'reopens by itself when the installer finishes.',
          confirmLabel: 'Close and install'
        });
        if (!ok) return;
        await apiSafe('updates:install');
      },
      openReleases: () => apiSafe('updates:openReleases'),
      toggleStart: async (ds, box) => {
        const on = box.checked ? '1' : '0';
        await apiSafe('settings:save', { settings: { updates_check_on_start: on } });
        settings.updates_check_on_start = on;
        window.App.settings = Object.assign({}, window.App.settings,
          { updates_check_on_start: on });
        toast(on === '1'
          ? 'Will check for updates at start-up'
          : 'Start-up check switched off', 'success');
      }
    });

    // Keep the screen live while a download runs.
    if (window.App.onUpdateState) {
      window.App.onUpdateState((next) => {
        if (window.App.current !== 'settings' || state.tab !== 'updates') return;
        drawUpdates(ctx, next, feed);
      });
    }
  }

  function updateCard(status, current) {
    const s = status.status || 'idle';
    const startOn = String(value('updates_check_on_start') || '1') !== '0';

    let body = '';
    let foot = '';

    if (s === 'downloading') {
      const pct = Math.max(2, Number(status.percent) || 0);
      body =
        '<p class="small">Downloading version <strong>' + esc(status.version || '') +
          '</strong>&hellip;</p>' +
        '<div class="dl-track"><i style="width:' + pct + '%"></i></div>' +
        '<p class="tiny faint mt8">' + pct + '% &middot; ' +
          fmt.bytes(status.transferred || 0) + ' of ' + fmt.bytes(status.total || 0) +
          (status.bytesPerSecond
            ? ' &middot; ' + fmt.bytes(status.bytesPerSecond) + '/s' : '') +
        '</p>';
    } else if (s === 'downloaded') {
      body = '<div class="banner good" style="margin:0">' + icon('check', 17) +
        '<div><strong>Version ' + esc(status.version || '') + ' is ready to install.</strong> ' +
        'The software will close, install, and reopen. Nothing of yours is touched.</div></div>';
      foot = '<button class="btn" data-action="install">' + icon('download', 15) +
        'Close and install now</button>';
    } else if (s === 'available') {
      body = '<div class="banner warn" style="margin:0">' + icon('download', 17) +
        '<div><strong>Version ' + esc(status.version || '') + ' is available.</strong> ' +
        'You are on ' + esc(current) + '. The release notes are below.</div></div>' +
        (status.error ? '<p class="small neg mt8">' + esc(status.error) + '</p>' : '');
      foot = (status.canSelfUpdate
        ? '<button class="btn" data-action="download">' + icon('download', 15) +
          'Download the update</button>'
        : '') +
        '<button class="btn secondary" data-action="openReleases">' +
        'Open the releases page</button>' +
        (status.canSelfUpdate
          ? ''
          : '<span class="tiny faint">This copy runs from source, so it cannot ' +
            'install an update itself.</span>');
    } else if (s === 'error') {
      body = '<div class="banner bad" style="margin:0">' + icon('alert', 17) +
        '<div><strong>The update check did not finish.</strong> ' +
        esc(status.error || '') + '</div></div>';
    } else if (s === 'current') {
      body = '<div class="banner good" style="margin:0">' + icon('check', 17) +
        '<div><strong>You are up to date.</strong> Version ' + esc(current) +
        ' is the newest release.</div></div>';
    } else {
      body = '<p class="small faint" style="margin:0">Press Check for updates to ask ' +
        'GitHub whether a newer version has been published.</p>';
    }

    return card({
      title: 'Software updates',
      hint: status.checkedAt ? 'last checked ' + fmt.relative(status.checkedAt) : '',
      body:
        '<div class="ver-grid mb14">' +
          versionRow('Installed version', current) +
          versionRow('Newest release',
            status.version || (status.checkedAt ? current : 'not checked yet')) +
        '</div>' +
        body +
        '<label class="check mt14" style="margin-bottom:0">' +
          '<input type="checkbox" data-action="toggleStart"' +
            (startOn ? ' checked' : '') + '>' +
          '<span>Check for updates when the software starts' +
            '<small>Only the version number and the notes are fetched, once a day at ' +
            'most. Nothing is downloaded or installed without you pressing a ' +
            'button.</small></span>' +
        '</label>',
      foot:
        '<button class="btn secondary" data-action="check">' + icon('refresh', 15) +
        'Check for updates</button>' + foot
    });
  }

  function noticesCard(feed) {
    const notices = (feed.notices || []).slice()
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    if (!notices.length) return '';
    return '<div class="mt14">' + card({
      title: 'Messages',
      hint: 'from the person who maintains this software',
      body: notices.map((notice) =>
        '<article class="notice ' + esc(notice.kind) + '">' +
          '<div class="notice-head">' +
            '<span class="notice-kind">' + esc(notice.kind) + '</span>' +
            '<strong>' + esc(notice.title) + '</strong>' +
            '<span class="spacer"></span>' +
            (notice.postedAt
              ? '<span class="tiny faint">' + esc(fmt.date(notice.postedAt)) + '</span>'
              : '') +
          '</div>' +
          (notice.body
            ? '<div class="notice-body">' + notesHtml(notice.body) + '</div>' : '') +
        '</article>').join('')
    }) + '</div>';
  }

  function releasesCard(feed, current) {
    const releases = feed.releases || [];
    if (!releases.length) return '';
    return '<div class="mt14">' + card({
      title: 'Release notes',
      hint: 'newest first',
      body: releases.map((release, index) => {
        const isCurrent = release.version === current;
        return '<details class="faq release"' + (index === 0 ? ' open' : '') + '>' +
          '<summary>' +
            '<span class="mono">' + esc(release.version) + '</span> ' +
            esc(release.title) +
            (isCurrent ? ' ' + badge('installed', 'good') : '') +
            (release.publishedAt
              ? ' <span class="tiny faint">' + esc(fmt.date(release.publishedAt)) +
                '</span>'
              : '') +
          '</summary>' +
          '<div class="notes">' + notesHtml(release.notes) + '</div>' +
          '</details>';
      }).join('') +
        '<div class="btn-row mt14">' +
          '<button class="btn sm secondary" data-action="openReleases">' +
          'See them all on GitHub</button>' +
        '</div>'
    }) + '</div>';
  }

  // =========================================================================
  // Help & tutorial
  //
  // Every topic carries a written answer and a guided run-through of the real
  // screen. Somebody who gets stuck on one part of the software can re-run
  // just that part without sitting through the rest.
  // =========================================================================

  async function helpTab(ctx) {
    const host = document.getElementById('set-body');
    const topics = (window.Guide && window.Guide.TOPICS) || [];

    host.innerHTML =
      '<div class="help-hero">' +
        '<div>' +
          '<h2>How ' + esc(productName()) + ' works</h2>' +
          '<p>A guided run-through of each part of the software, on your own ' +
            'screens with your own data. Take the whole thing once, then come ' +
            'back for whichever part you need again.</p>' +
          '<div class="btn-row">' +
            '<button class="btn" data-action="tourAll">' + icon('play', 15) +
              'Take the full run-through</button>' +
            '<span class="tiny faint">' + totalSteps(topics) +
              ' steps &middot; about four minutes</span>' +
          '</div>' +
        '</div>' +
        '<div class="help-hero-mark">' + icon('help', 40) + '</div>' +
      '</div>' +

      '<div class="field mt14" style="max-width:380px">' +
        '<div class="search-box">' + icon('search', 14) +
        '<input type="text" id="faq-search" placeholder="Search the questions" ' +
        'spellcheck="false"></div>' +
      '</div>' +

      '<div class="help-grid mt14" id="faq-grid">' +
        topics.map(topicCard).join('') +
      '</div>' +

      '<p class="tiny faint mt22" style="line-height:1.7">' +
        'Still stuck? The full written manual is <code class="inline">README.md</code> ' +
        'in the installation folder, and Settings &rarr; About shows where ' +
        'everything on this computer lives.</p>';

    bindActions(host, {
      tourAll: () => window.Guide.run('all'),
      tour: (ds) => window.Guide.run(ds.topic)
    });

    // Typing filters the questions, and hides a topic that holds none.
    const search = document.getElementById('faq-search');
    search.addEventListener('input', () => {
      const term = search.value.trim().toLowerCase();
      host.querySelectorAll('[data-faq-card]').forEach((cardEl) => {
        let visible = 0;
        cardEl.querySelectorAll('details').forEach((item) => {
          const hit = !term || item.textContent.toLowerCase().includes(term);
          item.hidden = !hit;
          item.open = Boolean(term) && hit;
          if (hit) visible += 1;
        });
        const topicHit = !term ||
          cardEl.getAttribute('data-label').toLowerCase().includes(term);
        cardEl.hidden = !(visible > 0 || topicHit);
      });
    });
  }

  function totalSteps(topics) {
    return topics.reduce((sum, topic) => sum + topic.steps.length, 0);
  }

  function topicCard(topic) {
    return '<section class="card faq-card" data-faq-card data-label="' +
      esc(topic.label) + '">' +
      '<div class="card-head">' +
        '<span class="faq-ico">' + icon(topic.icon, 16) + '</span>' +
        '<h2>' + esc(topic.label) + '</h2>' +
        '<span class="spacer"></span>' +
        '<button class="btn sm secondary" data-action="tour" data-topic="' +
          esc(topic.id) + '">' + icon('play', 13) + 'Run through</button>' +
      '</div>' +
      '<div class="card-body">' +
        '<p class="faq-blurb">' + esc(topic.blurb) + '</p>' +
        topic.faq.map((item) =>
          '<details class="faq"><summary>' + esc(item.q) + '</summary>' +
          '<p>' + esc(item.a) + '</p></details>').join('') +
      '</div>' +
    '</section>';
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
