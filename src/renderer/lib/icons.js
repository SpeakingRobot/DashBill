/**
 * Inline SVG icons. Monochrome 24x24 line icons that take their colour from
 * `currentColor`, so they work on the black sidebar and on white cards alike.
 */
(function () {
  'use strict';

  const PATHS = {
    dashboard: '<rect x="3" y="3" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="3" width="7.5" height="5" rx="1"/><rect x="13.5" y="11" width="7.5" height="10" rx="1"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1"/>',
    income: '<path d="M12 21V3"/><path d="M6 9l6-6 6 6"/><path d="M4 21h16"/>',
    expense: '<path d="M12 3v18"/><path d="M18 15l-6 6-6-6"/><path d="M4 3h16"/>',
    projects: '<path d="M3 7h18v13a1 1 0 01-1 1H4a1 1 0 01-1-1V7z"/><path d="M8 7V4a1 1 0 011-1h6a1 1 0 011 1v3"/><path d="M3 12h18"/>',
    invoice: '<path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5"/><path d="M9 12h7"/><path d="M9 16h7"/><path d="M9 8h3"/>',
    clients: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.5a3.2 3.2 0 010 7"/><path d="M18 20c0-2.2-.9-4.1-2.3-5.4"/>',
    reports: '<path d="M4 20V4"/><path d="M4 20h16"/><rect x="7" y="12" width="3.2" height="5"/><rect x="12.5" y="8" width="3.2" height="9"/><rect x="18" y="5" width="3.2" height="12"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 01-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 01-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 010-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 012.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 014 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 012.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 010 4h-.1a1.6 1.6 0 00-1.5 1z"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/>',
    edit: '<path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
    check: '<path d="M4 12.5l5 5L20 6.5"/>',
    close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
    download: '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 21h16"/>',
    print: '<path d="M7 9V3h10v6"/><rect x="4" y="9" width="16" height="8" rx="1"/><path d="M7 17h10v4H7z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0014.5 4H5.5A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 12h.01"/><path d="M18 12h.01"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="1.5"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
    alert: '<path d="M12 3l9.5 17H2.5z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 8h.01"/>',
    database: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.4 8.3-8 9.5C7.4 20.3 4 17 4 12V6z"/><path d="M9 12.5l2 2 4-4.5"/>',
    folder: '<path d="M3 7a1 1 0 011-1h5l2 2.5h9a1 1 0 011 1V19a1 1 0 01-1 1H4a1 1 0 01-1-1z"/>',
    refresh: '<path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 4v7h-7"/>',
    arrowRight: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
    arrowLeft: '<path d="M19 12H5"/><path d="M11 18l-6-6 6-6"/>',
    file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
    inbox: '<path d="M3 13l2.5-8h13L21 13v6a1 1 0 01-1 1H4a1 1 0 01-1-1z"/><path d="M3 13h5l1 2.5h6L16 13h5"/>',
    repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 21c0-4.1 3.4-7.5 7.5-7.5s7.5 3.4 7.5 7.5"/>',
    save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3"/><rect x="8" y="13" width="8" height="8"/>',
    upload: '<path d="M12 21V9"/><path d="M7 13l5-5 5 5"/><path d="M4 3h16"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="M4 18l5-5 3.5 3.5L16 13l4 5"/>',
    gst: '<path d="M4 6h16v12H4z"/><path d="M8 10h8"/><path d="M8 14h5"/>',
    play: '<path d="M7 4.5l12 7.5-12 7.5z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.3 9.3a2.8 2.8 0 015.4 1c0 1.9-2.7 2.3-2.7 4"/><path d="M12 17.5h.01"/>',
    signature: '<path d="M3 17c3.5 0 4-11 7-11s2 9 4.5 9c1.6 0 2-2.5 3.5-2.5"/><path d="M3 21h18"/>',
    bell: '<path d="M18 9a6 6 0 10-12 0c0 5-2 6-2 6h16s-2-1-2-6"/><path d="M10.5 20a2 2 0 003 0"/>',
    list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3.5 6h.01"/><path d="M3.5 12h.01"/><path d="M3.5 18h.01"/>'
  };

  /**
   * Build an icon's SVG markup.
   * @param {string} name   key from PATHS
   * @param {number} size   pixel size (default 16)
   */
  function icon(name, size) {
    const body = PATHS[name];
    if (!body) return '';
    const px = size || 16;
    return `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" ` +
      `stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ` +
      `stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  window.Icons = { icon, PATHS };
})();
