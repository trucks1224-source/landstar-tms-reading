// ▦ Table view of the load list (Daniel 2026-11-27): one row per load, 30+ on screen, sorted
// by any column. Pure, tested in loadTable.test.js. Rows come from the TMS (App.jsx builds
// them): { key, id, pickupAt, pickup, origin, destination, delivery, equipment, miles, rate,
// perMile, status, flags, exportedAt, exported }.

export const LOAD_TABLE_COLUMNS = [
  { key: 'id', label: '#', numeric: false },
  { key: 'pickupAt', label: 'Pickup', numeric: true },
  { key: 'origin', label: 'From', numeric: false },
  { key: 'destination', label: 'To', numeric: false },
  { key: 'delivery', label: 'Delivery', numeric: false },
  { key: 'equipment', label: 'Equip', numeric: false },
  { key: 'miles', label: 'Miles', numeric: true },
  { key: 'rate', label: 'Rate', numeric: true },
  { key: 'perMile', label: '$/mi', numeric: true },
  { key: 'status', label: 'Status', numeric: false },
  { key: 'exportedAt', label: 'Sent', numeric: true }
];

// Sorted copy of rows. Empty values (no rate, no miles...) always go last, either way.
export function sortLoadRows(rows, sortKey, descending = false) {
  const column = LOAD_TABLE_COLUMNS.find(item => item.key === sortKey);
  if (!column) return [...(rows || [])];
  const empty = value => value === undefined || value === null || value === '' || (column.numeric && !(Number(value) > 0));
  return [...(rows || [])].sort((a, b) => {
    const left = a[sortKey];
    const right = b[sortKey];
    if (empty(left) || empty(right)) return empty(left) === empty(right) ? 0 : empty(left) ? 1 : -1;
    const compared = column.numeric
      ? Number(left) - Number(right)
      : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
    return descending ? -compared : compared;
  });
}

// Clicking a column title: first click sorts it (high to low for money and miles, A to Z for
// the rest); clicking it again flips it.
export function nextLoadTableSort(current, key) {
  if (current?.key === key) return { key, descending: !current.descending };
  return { key, descending: ['rate', 'perMile', 'miles', 'exportedAt'].includes(key) };
}
