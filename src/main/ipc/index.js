'use strict';

/**
 * IPC registry.
 *
 * Every feature module exports a flat map of `channel name -> async handler`.
 * Handlers receive the payload the renderer sent (no Electron event object) and
 * return plain data. Thrown errors are converted into
 * `{ ok: false, error: { message, code } }` so the renderer never deals with
 * raw Electron exceptions.
 */

const { ipcMain } = require('electron');

const modules = [
  require('./app'),
  require('./settings'),
  require('./clients'),
  require('./projects'),
  require('./income'),
  require('./expenses'),
  require('./invoices'),
  require('./dashboard'),
  require('./backup'),
  require('./updates')
];

function register(context) {
  for (const mod of modules) {
    const handlers = typeof mod === 'function' ? mod(context) : mod;
    for (const [channel, handler] of Object.entries(handlers)) {
      ipcMain.handle(channel, async (_event, payload) => {
        try {
          const data = await handler(payload === undefined ? {} : payload, context);
          return { ok: true, data: data === undefined ? null : data };
        } catch (err) {
          if (process.env.NODE_ENV !== 'test') {
            console.error(`[ipc] ${channel} failed:`, err);
          }
          return {
            ok: false,
            error: {
              code: err && err.code ? err.code : 'ERROR',
              message: friendly(err)
            }
          };
        }
      });
    }
  }
}

/** Translate the few MySQL errors a user can actually cause into plain words. */
function friendly(err) {
  const message = err && err.message ? err.message : String(err);
  switch (err && err.code) {
    case 'ER_DUP_ENTRY':
      if (/uq_invoice_number/.test(message)) {
        return 'An invoice with that number already exists. Change the invoice number and try again.';
      }
      if (/uq_expense_category_name/.test(message)) {
        return 'An expense category with that name already exists.';
      }
      return 'That record already exists.';
    case 'ER_ROW_IS_REFERENCED_2':
      return 'This record is still used elsewhere, so it cannot be deleted. Deactivate it instead.';
    case 'ER_NO_REFERENCED_ROW_2':
      return 'A linked record (client or project) no longer exists. Refresh and try again.';
    case 'NO_DB':
      return message;
    default:
      return message;
  }
}

// `friendly` is exported so the end-to-end tests can assert on exactly the
// wording a user would see, rather than the raw driver message.
module.exports = { register, friendly };
