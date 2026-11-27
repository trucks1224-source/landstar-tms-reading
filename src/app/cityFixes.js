// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { stateCodes, editDistance } from './screenshotParsers.js';

// DAT region names that are not postal cities, so ZIP data cannot correct OCR misreads.
const datRegionCityAliases = {
  NY: { LONGLISLAND: 'LONG ISLAND' }
};

function correctDatCities(loads, zipData) {
  const normalize = value => String(value || '').toUpperCase().replace(/[^A-Z]/g, '');
  const cache = {};
  const citiesFor = state => {
    if (!cache[state]) {
      const names = Array.from(new Set((zipData.lookupByState?.(state) || []).map(item => String(item.city).toUpperCase())));
      cache[state] = names.map(name => ({ name, key: normalize(name) }));
    }
    return cache[state];
  };
  const fix = (load, cityKey, stateKey) => {
    const state = load[stateKey];
    const cities = state ? citiesFor(state) : [];
    if (!cities.length) return;
    const tokens = String(load[cityKey] || '').toUpperCase().split(/\s+/).filter(Boolean);
    if (!tokens.length || cities.some(city => city.name === tokens.join(' '))) return;
    let best = null;
    for (let start = 0; start < tokens.length; start += 1) {
      for (let end = tokens.length; end > start; end -= 1) {
        const text = tokens.slice(start, end).join(' ');
        const exact = cities.find(city => city.name === text || city.key === normalize(text));
        if (exact && (!best || text.length > best.length)) best = { length: text.length, name: exact.name };
      }
    }
    if (!best) {
      const joined = normalize(tokens.join(''));
      let bestDistance = 3;
      cities.forEach(city => {
        if (city.key.length < 5) return;
        const distance = editDistance(city.key, joined);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { name: city.name };
        }
      });
      Object.entries(datRegionCityAliases[state] || {}).forEach(([key, name]) => {
        const distance = editDistance(key, joined);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { name };
        }
      });
    }
    if (best) load[cityKey] = best.name;
  };
  loads.forEach(load => {
    fix(load, 'origCity', 'origSt');
    fix(load, 'destCity', 'destSt');
    load.route = `${load.origCity}${load.origSt ? `, ${load.origSt}` : ''} → ${load.destCity}${load.destSt ? `, ${load.destSt}` : ''}`;
  });
  return loads;
}

function correctCitiesFromZip(loads, zipData) {
  const normalize = value => String(value || '').toUpperCase().replace(/[^A-Z]/g, '');
  const fix = (load, cityKey, stateKey, zipKey) => {
    const zip = String(load[zipKey] || '').replace(/\D/g, '').slice(0, 5);
    const location = zip.length === 5 ? zipData.codes?.[zip] : null;
    const ocrCity = normalize(load[cityKey]);
    const truncated = /\.\.|…/.test(String(load[cityKey] || '')) && ocrCity.length >= 5;
    if (truncated && load[stateKey]) {
      const names = Array.from(new Set((zipData.lookupByState?.(load[stateKey]) || []).map(item => String(item.city))));
      const candidates = names.filter(name => normalize(name).startsWith(ocrCity));
      if (candidates.length === 1) {
        load[cityKey] = candidates[0].toUpperCase();
        return;
      }
    }
    if (!location && !load[stateKey] && ocrCity.length >= 3) {
      const cityName = String(load[cityKey]).trim();
      const states = Array.from(stateCodes).filter(code => zipData.lookupByName?.(cityName, code)?.length);
      if (states.length === 1) load[stateKey] = states[0];
      return;
    }
    if (!location) return;
    if (load[stateKey] && load[stateKey] !== location.state) return;
    const postalCity = normalize(location.city);
    // A ZIP's preferred postal city can differ from the actual load city.
    if (!ocrCity || ocrCity === postalCity
      || ocrCity.length >= 5 && editDistance(ocrCity, postalCity) <= 2
      || truncated && postalCity.startsWith(ocrCity)) {
      load[cityKey] = String(location.city).toUpperCase();
    }
    load[stateKey] = location.state;
  };
  loads.forEach(load => {
    fix(load, 'origCity', 'origSt', 'origZip');
    fix(load, 'destCity', 'destSt', 'destZip');
    load.route = `${load.origCity}${load.origSt ? `, ${load.origSt}` : ''} → ${load.destCity}${load.destSt ? `, ${load.destSt}` : ''}`;
  });
  return loads;
}

export {
  datRegionCityAliases,
  correctDatCities,
  correctCitiesFromZip
};
