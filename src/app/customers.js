// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { accountKey } from '../lib/accountAliases.js';
import { rxoCustomerName, rxoPayerCustomerName, ntgCustomerName, normalizeCustomerName } from '../lib/trackingEmails.js';

// Customer rules match one exact account. Accounts can share a name and number and differ
// only by the letter at the end ("Para 1522166 - ATZ" vs "Para 1522166 - ATZ H"): those
// are separate accounts, so a rule for one must never check just the name or number.
function isNolanCustomer(name) {
  return normalizeCustomerName(name) === ntgCustomerName;
}

function isRxoCustomer(name) {
  const normalized = normalizeCustomerName(name);
  return normalized === rxoCustomerName || normalized === rxoPayerCustomerName;
}

// Customers whose screenshots mark loads on hold with a red order number: a red order #
// imports as ON HOLD, any other as OPEN. Para 1522166 - ATZ and Para 1522166 - ATZ H.
const redHoldScreenshotCustomers = new Set(['PARA1522166ATZ', 'PARA1522166ATZH']);

function holdsRedScreenshotLoads(name) {
  return redHoldScreenshotCustomers.has(accountKey(normalizeCustomerName(name)));
}

function isCh593772Customer(name) {
  return /^CH593772(?:ATZ[A-Z]?)?$/.test(normalizeCustomerName(name).toUpperCase().replace(/[^A-Z0-9]/g, ''));
}

export {
  isNolanCustomer,
  isRxoCustomer,
  redHoldScreenshotCustomers,
  holdsRedScreenshotLoads,
  isCh593772Customer
};
