// Customer list grouping (Daniel 2026-11-27: "make it look better"). Accounts that share a name and
// number, like "R X O 2429200 - ATZ V" and "R X O 2429200 - ATZ P", show as one row with a button
// per account (ATZ V, ATZ P, ...). Tested in customerGroups.test.js.

// "R X O 2429200 - ATZ V" → { base: 'R X O 2429200', tag: 'ATZ V' }; no number + dash → no tag.
export function splitCustomerName(name) {
  const text = String(name || '').trim();
  const match = text.match(/^(.*\d)\s*-\s*(.+)$/);
  return match ? { base: match[1].trim(), tag: match[2].trim() } : { base: text, tag: '' };
}

const groupKey = base => base.toUpperCase().replace(/\s+/g, '');

// The list in its saved order, as rows: { key, base, members: [{ name, tag }] }. A row with one
// member is an ordinary customer; a row sits where its first account is in the list.
export function groupCustomers(brokers) {
  const rows = [];
  const byKey = new Map();
  for (const name of brokers || []) {
    const { base, tag } = splitCustomerName(name);
    const key = tag ? groupKey(base) : `single:${name}`;
    let row = byKey.get(key);
    if (!row) {
      row = { key, base, members: [] };
      byKey.set(key, row);
      rows.push(row);
    }
    row.members.push({ name, tag });
  }
  return rows.map(row => (row.members.length === 1
    ? { key: `single:${row.members[0].name}`, base: row.members[0].name, members: [{ name: row.members[0].name, tag: '' }] }
    : row));
}

// Drag a whole row: moves all its accounts, in their order, to where the target account is.
export function moveCustomers(list, names, targetName) {
  const moving = (names || []).filter(name => list.includes(name));
  if (!moving.length || moving.includes(targetName) || !list.includes(targetName)) return list;
  const from = list.indexOf(moving[0]);
  const rest = list.filter(name => !moving.includes(name));
  let at = rest.indexOf(targetName);
  // Dragged down the list: land after the target, like dragging one customer does.
  if (from < list.indexOf(targetName)) at += 1;
  rest.splice(at, 0, ...moving);
  return rest;
}

// The short name on a customer row: "R X O 2429200" → "RXO", "Para 1522166" → "Para".
export function shortAccountName(base) {
  const name = String(base || '').replace(/[\s-]*\d[\d\s-]*$/, '').trim();
  const short = /^([A-Za-z] )+[A-Za-z]$/.test(name) ? name.replace(/\s+/g, '') : name;
  return short || String(base || '').trim();
}

// The color of an account tab, from its name: van, reefer, flat, haz, panels, snb or plain.
export function accountTagKind(tag) {
  const text = String(tag || '').trim().toUpperCase();
  if (/^N\s*HAZ/.test(text) || /^(ATZ\s*)?V(AN)?$/.test(text)) return 'van';
  if (/HAZ|^ATZ\s*H$/.test(text)) return 'haz';
  if (/REEF|^ATZ\s*R$/.test(text)) return 'reefer';
  if (/FLAT|^ATZ\s*F$/.test(text)) return 'flat';
  if (/PANEL|SOLAR|^ATZ\s*P$/.test(text)) return 'panels';
  if (/SNB/.test(text)) return 'snb';
  return 'plain';
}
