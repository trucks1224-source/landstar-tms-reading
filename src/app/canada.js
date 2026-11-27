// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
// CANADIAN POSTAL CODE AUTO-FILL (the zipcodes package is US-only)
// Key: "CITY, PROVINCE" (uppercase). Value: a representative postal code.
// Add recurring Canadian lanes here as they come up.
const canadianPostalDatabase = {
  // Quebec
  "ST JN S RICHELIEU, QC": "J3B 1A1",
  "SAINT JEAN SUR RICHELIEU, QC": "J3B 1A1",
  "ST JEAN SUR RICHELIEU, QC": "J3B 1A1",
  "MONTREAL, QC": "H1A 0A1",
  "QUEBEC, QC": "G1A 0A1",
  "QUEBEC CITY, QC": "G1A 0A1",
  "LAVAL, QC": "H7A 0A1",
  "GATINEAU, QC": "J8P 0A1",
  "LONGUEUIL, QC": "J3Y 0A1",
  "SHERBROOKE, QC": "J1H 0A1",
  "TROIS RIVIERES, QC": "G8T 0A1",
  "DRUMMONDVILLE, QC": "J2A 0A1",
  "GRANBY, QC": "J2G 0A1",
  "SAINT HYACINTHE, QC": "J2R 0A1",
  "BROSSARD, QC": "J4W 0A1",
  // Ontario
  "TORONTO, ON": "M1A 0A1",
  "MISSISSAUGA, ON": "L4T 0A1",
  "BRAMPTON, ON": "L6P 0A1",
  "VAUGHAN, ON": "L4H 0A1",
  "ETOBICOKE, ON": "M8V 0A1",
  "SCARBOROUGH, ON": "M1B 0A1",
  "MARKHAM, ON": "L3P 0A1",
  "HAMILTON, ON": "L8E 0A1",
  "LONDON, ON": "N5V 0A1",
  "KITCHENER, ON": "N2A 0A1",
  "CAMBRIDGE, ON": "N1R 0A1",
  "GUELPH, ON": "N1E 0A1",
  "WINDSOR, ON": "N8N 0A1",
  "OTTAWA, ON": "K1A 0A1",
  "BARRIE, ON": "L4M 0A1",
  "OSHAWA, ON": "L1G 0A1",
  "BURLINGTON, ON": "L7L 0A1",
  "OAKVILLE, ON": "L6H 0A1",
  "MILTON, ON": "L9T 0A1",
  "AJAX, ON": "L1S 0A1",
  "PICKERING, ON": "L1V 0A1",
  "WHITBY, ON": "L1M 0A1",
  "KINGSTON, ON": "K7K 0A1",
  "SUDBURY, ON": "P3A 0A1",
  "THUNDER BAY, ON": "P7A 0A1",
  "SARNIA, ON": "N7S 0A1",
  "BELLEVILLE, ON": "K8N 0A1",
  "CORNWALL, ON": "K6H 0A1",
  "BROCKVILLE, ON": "K6V 0A1",
  "NIAGARA FALLS, ON": "L2E 0A1",
  "ST CATHARINES, ON": "L2M 0A1",
  // Manitoba
  "WINNIPEG, MB": "R2C 0A1",
  "BRANDON, MB": "R7A 0A1",
  // Saskatchewan
  "REGINA, SK": "S4N 0A1",
  "SASKATOON, SK": "S7H 0A1",
  // Alberta
  "CALGARY, AB": "T1X 0A1",
  "EDMONTON, AB": "T5A 0A1",
  "RED DEER, AB": "T4N 0A1",
  "LETHBRIDGE, AB": "T1H 0A1",
  "FORT MCMURRAY, AB": "T9H 0A1",
  // British Columbia
  "VANCOUVER, BC": "V5K 0A1",
  "SURREY, BC": "V3R 0A1",
  "BURNABY, BC": "V5A 0A1",
  "RICHMOND, BC": "V6V 0A1",
  "DELTA, BC": "V3M 0A1",
  "LANGLEY, BC": "V2Y 0A1",
  "ABBOTSFORD, BC": "V2S 0A1",
  "KELOWNA, BC": "V1V 0A1",
  "VICTORIA, BC": "V8T 0A1",
  "KAMLOOPS, BC": "V1S 0A1",
  "PRINCE GEORGE, BC": "V2L 0A1",
  // New Brunswick
  "MONCTON, NB": "E1A 0A1",
  "SAINT JOHN, NB": "E2H 0A1",
  "FREDERICTON, NB": "E3A 0A1",
  // Nova Scotia
  "HALIFAX, NS": "B3H 0A1",
  "DARTMOUTH, NS": "B2V 0A1",
  "SYDNEY, NS": "B1L 0A1",
  // Prince Edward Island
  "CHARLOTTETOWN, PE": "C1A 0A1",
  // Newfoundland and Labrador
  "ST JOHNS, NL": "A1A 0A1",
  // Yukon / Northwest Territories / Nunavut
  "WHITEHORSE, YT": "Y1A 0A1",
  "YELLOWKNIFE, NT": "X1A 0A1",
  "IQALUIT, NU": "X0A 0H0"
};

// A Canadian city and its postal code. Customer lists cut long names short ("BURLINGT, ON" in
// Paramount's list, 2026-11-25), so with no exact match a unique city in that province that
// starts with the given letters counts (5+ letters). Returns { city, postal } or null.
function findCanadianPlace(city, province) {
  const name = String(city || '').trim().toUpperCase().replace(/\.+$/, '').trim();
  const region = String(province || '').trim().toUpperCase();
  if (!name || !region) return null;
  const exact = canadianPostalDatabase[`${name}, ${region}`];
  if (exact) return { city: name, postal: exact };
  const letters = value => value.replace(/[^A-Z]/g, '');
  if (letters(name).length < 5) return null;
  const matches = Object.keys(canadianPostalDatabase).filter(key => {
    const [keyCity, keyRegion] = key.split(', ');
    return keyRegion === region && letters(keyCity).startsWith(letters(name));
  });
  if (matches.length !== 1) return null;
  return { city: matches[0].split(', ')[0], postal: canadianPostalDatabase[matches[0]] };
}

function lookupCanadianPostalCode(city, province) {
  return findCanadianPlace(city, province)?.postal || '';
}

function normalizeCanadianPostalCode(value) {
  const compact = String(value || '').toUpperCase().replace(/[\s-]/g, '');
  if (!/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(compact)) return '';
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}

export {
  canadianPostalDatabase,
  findCanadianPlace,
  lookupCanadianPostalCode,
  normalizeCanadianPostalCode
};
