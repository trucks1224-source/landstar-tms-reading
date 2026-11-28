// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
const defaultFuelSurchargeRates = { east: '0.86', midwest: '0.88', west: '1.03', newEngland: '0.89' };

function normalizeFuelSurchargeRates(value) {
  const rates = { ...defaultFuelSurchargeRates };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return rates;
  // Settings saved before the four email regions: National -> East and Midwest, West Coast -> West.
  if (!['east', 'midwest', 'west'].some(key => key in value) && ('national' in value || 'westCoast' in value)) {
    value = { east: value.national, midwest: value.national, west: value.westCoast, newEngland: value.newEngland };
  }
  Object.keys(rates).forEach(key => {
    const parsed = Number(String(value[key] ?? '').replace(/[$,]/g, ''));
    rates[key] = parsed > 0 ? String(Math.round(parsed * 100) / 100) : '';
  });
  return rates;
}

// The weekly fuel email: "11/3/2026   East .86  Midwest .88   West 1.03 New England .89".
// Returns { date, rates } or null (all four rates must be there and look like $/mile).
function parseFuelSurchargeEmail(text) {
  const value = String(text || '');
  const rate = name => {
    const match = value.match(new RegExp(`${name}\\s*[:=]?\\s*\\$?(\\d*\\.\\d+|\\d+(?:\\.\\d+)?)`, 'i'));
    const number = match ? Number(match[1]) : NaN;
    return number >= 0.3 && number <= 2.5 ? String(Math.round(number * 100) / 100) : '';
  };
  const rates = { east: rate('(?<!north)east'), midwest: rate('midwest'), west: rate('(?<!mid)west'), newEngland: rate('new\\s*england') };
  if (Object.values(rates).some(item => !item)) return null;
  const date = value.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/)?.[1] || '';
  return { date, rates };
}

export {
  defaultFuelSurchargeRates,
  normalizeFuelSurchargeRates,
  parseFuelSurchargeEmail
};
