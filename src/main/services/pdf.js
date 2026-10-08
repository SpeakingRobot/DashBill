'use strict';

/**
 * HTML -> PDF, rendered locally by Chromium.
 *
 * The invoice HTML is loaded into an invisible BrowserWindow and printed with
 * Chromium's own PDF engine (the same one behind Ctrl+P in Chrome), so no
 * external tool, font pack or internet connection is involved. Margins are 0
 * here because the template's `.sheet` already holds the 14 mm A4 margin.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { BrowserWindow } = require('electron');

/**
 * Write the document to a temporary file and hand back its path.
 *
 * The HTML goes through a real file rather than a `data:` URL: an embedded
 * logo pushes a data URL into the megabytes, where Chromium starts refusing
 * the navigation outright with ERR_FAILED, and percent-encoding the whole
 * document on every export is wasted work besides.
 */
function writeTempHtml(html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anjoy-invoice-'));
  const file = path.join(dir, 'invoice.html');
  fs.writeFileSync(file, html, 'utf8');
  return { file, dir };
}

function removeTemp(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a leftover temp file is harmless; the OS clears it */
  }
}

const PRINT_OPTIONS = {
  pageSize: 'A4',
  printBackground: true,
  landscape: false,
  margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 },
  preferCSSPageSize: true
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One attempt: fresh offscreen window, load, print, tear down. */
async function renderOnce(file) {
  const win = new BrowserWindow({
    show: false,
    width: 1240,
    height: 1754,
    webPreferences: {
      offscreen: true,
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  try {
    await win.webContents.loadFile(file);
    // Give the layout engine a frame to settle the logo image and web fonts.
    await sleep(180);
    return await win.webContents.printToPDF(PRINT_OPTIONS);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/**
 * Render an HTML document to a PDF buffer.
 *
 * Tearing an offscreen window down and standing another one up straight away
 * occasionally has Chromium abandon the next load with ERR_FAILED — it shows
 * up when several invoices are exported back to back. Nothing is wrong with
 * the document, so the attempt is simply repeated after letting the previous
 * window finish going away.
 */
async function htmlToPdfBuffer(html) {
  const temp = writeTempHtml(html);
  let lastError = null;

  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await renderOnce(temp.file);
      } catch (err) {
        lastError = err;
        if (attempt < 3) await sleep(250 * attempt);
      }
    }
    throw lastError || new Error('The invoice could not be rendered.');
  } finally {
    removeTemp(temp.dir);
  }
}

/** Write a PDF to disk, creating the folder if needed. Returns the path. */
async function htmlToPdfFile(html, filePath) {
  const buffer = await htmlToPdfBuffer(html);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/** Turn an invoice number into something Windows will accept as a filename. */
function safeFileName(text) {
  return String(text || 'invoice')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  htmlToPdfBuffer, htmlToPdfFile, safeFileName, writeTempHtml, removeTemp
};
