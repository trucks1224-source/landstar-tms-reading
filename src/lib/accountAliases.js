// Renamed accounts (Daniel 2026-11-27: "use the new names"). The TMS's rules were written for the
// old spellings; accountKey() gives a renamed account the old one's key, so every rule (auto
// export, Para ON HOLD screenshots, full-list re-imports, tracking emails) still applies.
// Accounts are never matched by number alone ("ATZ" and "ATZ H" stay different accounts).
const accountAliases = {
  RXO2429200VAN: 'RXO2429200ATZV',
  RXO2429200REEFER: 'RXO2429200ATZR',
  RXO2429200FLAT: 'RXO2429200ATZF',
  RXO2429200PANELS: 'RXO2429200ATZP',
  RXO2429200HAZ: 'RXO2429200ATZH',
  RXO2429200HAZMAT: 'RXO2429200ATZH',
  PARA1522166HAZ: 'PARA1522166ATZH',
  PARA1522166NHAZ: 'PARA1522166ATZ',
  NOLAN965974HAZ: 'NOLAN965974ATZH'
};

const rawKey = name => String(name || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

// "R X O 2429200 - VAN" and "R X O 2429200 - ATZ V" → 'RXO2429200ATZV'.
export function accountKey(name) {
  const key = rawKey(name);
  return accountAliases[key] || key;
}

export function isSameAccount(left, right) {
  return Boolean(rawKey(left)) && accountKey(left) === accountKey(right);
}

// The customer-list spelling of an account ("R X O 2429200 - ATZ V" → "R X O 2429200 - VAN"
// when that is in the list). The new name wins when both spellings are listed; '' when the
// account is not in the list at all.
export function findListedAccount(name, brokers = []) {
  if (!rawKey(name)) return '';
  const matches = (brokers || []).filter(broker => isSameAccount(broker, name));
  return matches.find(broker => accountAliases[rawKey(broker)]) || matches[0] || '';
}
