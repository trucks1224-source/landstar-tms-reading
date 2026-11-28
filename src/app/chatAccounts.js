// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { normalizeCustomerName } from '../lib/trackingEmails.js';
import { accountKey, findListedAccount } from '../lib/accountAliases.js';

// Ctrl+V of a picture: which list it is. Para lists come from Heather in Google Chat:
// the account ending in H is hazmat, the other one non-hazmat.
const pasteImportChoices = [
  { label: 'Para 1522166 - ATZ · non-hazmat list', customer: 'Para 1522166 - ATZ', className: 'bg-sky-700 hover:bg-sky-600' },
  { label: 'Para 1522166 - ATZ H · hazmat list', customer: 'Para 1522166 - ATZ H', className: 'bg-red-700 hover:bg-red-600' },
  { label: 'NTG load cards', customer: '', className: 'bg-slate-700 hover:bg-slate-600' }
];

// Labels Daniel told us (2026-11-27); a label he picks in the TMS is saved on top of these.
const defaultChatSheetAccounts = {
  'big list': 'R X O 2429200 - ATZ V',
  fbs: 'R X O 2429200 - ATZ F', fb: 'R X O 2429200 - ATZ F', flatbed: 'R X O 2429200 - ATZ F', flatbeds: 'R X O 2429200 - ATZ F',
  reefer: 'R X O 2429200 - ATZ R', reefers: 'R X O 2429200 - ATZ R',
  haz: 'R X O 2429200 - ATZ H', hazmat: 'R X O 2429200 - ATZ H',
  // Solar panels: Tyler labels this list "panels" or "solar".
  panels: 'R X O 2429200 - ATZ P', panel: 'R X O 2429200 - ATZ P',
  solar: 'R X O 2429200 - ATZ P', 'solar panels': 'R X O 2429200 - ATZ P', 'solar panel': 'R X O 2429200 - ATZ P'
};

// Accounts whose Google Chat lists export to Landstar by themselves right after the import
// (Daniel 2026-11-27: "only RXO"). Never R X O 2429200 - SNB: those are Ivan's loads and must
// post under his own code, from his TMS.
const chatAutoExportAccounts = new Set([
  'R X O 2429200 - ATZ V', 'R X O 2429200 - ATZ F', 'R X O 2429200 - ATZ R',
  'R X O 2429200 - ATZ H', 'R X O 2429200 - ATZ P'
].map(name => name.toUpperCase().replace(/[^A-Z0-9]/g, '')));

function isChatAutoExportAccount(customer) {
  return chatAutoExportAccounts.has(accountKey(normalizeCustomerName(customer)));
}

// Lists in LANDJA18 for agent SNB (Ivan): "LOWES" and the one marked "$$" import into
// R X O 2429200 - SNB, an account Daniel shares with Ivan, so they show up in Ivan's TMS and
// post under Ivan's own code (Daniel 2026-11-27). "$$" has no letters, so it is matched here.
const SNB_CHAT_ACCOUNT = 'R X O 2429200 - SNB';

function getSnbChatSheetAccount(label) {
  const text = String(label || '');
  return /lowe'?s/i.test(text) || /\$\s*\$/.test(text) ? SNB_CHAT_ACCOUNT : '';
}

// A list label without what changes from day to day: case, numbers/dates, punctuation.
// "Big List 11/27!" -> "big list".
function getChatSheetKey(label) {
  return String(label || '').toLowerCase()
    .replace(/\d+/g, ' ')
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

function getChatSheetAccount(rules, label) {
  const snb = getSnbChatSheetAccount(label);
  if (snb) return snb;
  const key = getChatSheetKey(label);
  if (!key) return '';
  const saved = rules && typeof rules === 'object' ? rules[key] : '';
  return String(saved || defaultChatSheetAccounts[key] || '');
}

function rememberChatSheetAccount(rules, label, customer) {
  const key = getChatSheetKey(label);
  if (!key || !customer) return { ...(rules || {}) };
  return { ...(rules || {}), [key]: customer };
}

// The accounts offered for a chat item: RXO's chat offers the RXO accounts, Para's chat
// the Para accounts and NTG cards (pictures only: NTG cards are never spreadsheets).
function getChatInboxChoices(item, brokers = []) {
  const colors = ['bg-sky-700 hover:bg-sky-600', 'bg-red-700 hover:bg-red-600', 'bg-amber-700 hover:bg-amber-600', 'bg-emerald-700 hover:bg-emerald-600', 'bg-indigo-700 hover:bg-indigo-600'];
  const isSheet = item?.type === 'spreadsheet';
  if (item?.kind === 'rxo') {
    // Every RXO account (R X O 2429200 - ATZ, ATZ H, ATZ P, ATZ R...), not just the main one.
    return brokers.filter(name => /^\s*R\s*X\s*O\b/i.test(normalizeCustomerName(name)))
      .map((customer, index) => ({ label: customer, customer, className: colors[index % colors.length] }));
  }
  const choices = getPasteImportChoices(brokers);
  return isSheet ? choices.filter(choice => choice.customer) : choices;
}

// The Para choices under the names in the customer list ("Para 1522166 - N HAZ" for the old
// "Para 1522166 - ATZ"), so a renamed account still gets its pictures.
function getPasteImportChoices(brokers = []) {
  return pasteImportChoices.map(choice => {
    const customer = choice.customer ? findListedAccount(choice.customer, brokers) || choice.customer : '';
    return customer === choice.customer ? choice : { ...choice, customer, label: `${customer} Â· ${choice.label.split(' Â· ').pop()}` };
  });
}

export {
  pasteImportChoices,
  defaultChatSheetAccounts,
  chatAutoExportAccounts,
  isChatAutoExportAccount,
  SNB_CHAT_ACCOUNT,
  getSnbChatSheetAccount,
  getChatSheetKey,
  getChatSheetAccount,
  rememberChatSheetAccount,
  getChatInboxChoices,
  getPasteImportChoices
};
