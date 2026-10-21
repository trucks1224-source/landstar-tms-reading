import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';

const exportedLoadRetentionMs = 30 * 24 * 60 * 60 * 1000;

function removeExpiredExportedLoads(customerOrders, now = Date.now()) {
  let changed = false;
  const nextOrders = {};
  Object.entries(customerOrders).forEach(([customer, loads]) => {
    nextOrders[customer] = loads.filter(load => {
      if (!load.landstarExportedAt) return true;
      const exportedAt = Date.parse(load.landstarExportedAt);
      const keep = !Number.isFinite(exportedAt) || now - exportedAt < exportedLoadRetentionMs;
      if (!keep) changed = true;
      return keep;
    });
  });
  return changed ? nextOrders : customerOrders;
}

const screenshotColumns = [0, 0.024, 0.081, 0.171, 0.27, 0.352, 0.452, 0.547, 0.58, 0.616, 0.693, 0.724, 0.78, 0.815, 0.856, 1];
const stateCodes = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));

function clusterPositions(values, tolerance = 0.012) {
  const sorted = [...values].sort((a, b) => a - b);
  const clusters = [];
  sorted.forEach(value => {
    const last = clusters[clusters.length - 1];
    if (last && value - last.max <= tolerance) {
      last.max = value;
      last.count += 1;
    } else {
      clusters.push({ min: value, max: value, count: 1 });
    }
  });
  return clusters;
}

function detectColumnsFromData(allWords, imageWidth) {
  const words = allWords.map(word => ({
    text: word.text,
    x0: word.bbox.x0 / imageWidth,
    x1: word.bbox.x1 / imageWidth
  }));
  const margin = 0.004;
  const largest = clusters => [...clusters].sort((a, b) => b.count - a.count)[0];

  const dateWords = words.filter(word => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(word.text));
  const dateClusters = clusterPositions(dateWords.map(word => word.x0));
  const strongest = Math.max(0, ...dateClusters.map(cluster => cluster.count));
  const dateColumns = dateClusters.filter(cluster => cluster.count >= Math.max(2, strongest * 0.3));
  if (dateColumns.length !== 4) return null;

  const distanceCluster = largest(clusterPositions(
    words.filter(word => /^[^A-Za-z0-9]*\d{2,4}\.\d[^A-Za-z0-9]*$/.test(word.text)).map(word => word.x0)
  ));
  if (!distanceCluster || distanceCluster.count < 2) return null;
  const distanceStart = distanceCluster.min;

  const zipClusters = clusterPositions(words
    .filter(word => /^[^A-Za-z0-9]*\d{5}[^A-Za-z0-9]*$/.test(word.text) && !/\.\./.test(word.text)
      && word.x0 > dateColumns[3].min + 0.1 && word.x0 < distanceStart - 0.02)
    .map(word => word.x0))
    .filter(cluster => cluster.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
    .sort((a, b) => a.min - b.min);
  if (zipClusters.length !== 2) return null;
  const [originZip, destZip] = zipClusters.map(cluster => cluster.min);

  const cityStart = (from, to) => largest(clusterPositions(words
    .filter(word => word.x0 > from && word.x0 < to && /[A-Za-z]{3,}/.test(word.text))
    .map(word => word.x0)));
  const originCity = cityStart(dateColumns[3].min + 0.07, originZip - 0.04);
  const destCity = cityStart(originZip + 0.04, destZip - 0.04);
  if (!originCity || !destCity) return null;

  const weightCluster = largest(clusterPositions(words
    .filter(word => word.x0 > distanceStart + 0.03 && /^[^A-Za-z]*\d{4,6}/.test(word.text))
    .map(word => word.x0)));
  if (!weightCluster) return null;

  const columns = [
    0,
    dateColumns[0].min - 0.06,
    dateColumns[0].min - margin,
    dateColumns[1].min - margin,
    dateColumns[2].min - margin,
    dateColumns[3].min - margin,
    originCity.min - margin,
    originCity.min + (originZip - originCity.min) * 0.6,
    originZip - margin,
    destCity.min - margin,
    destCity.min + (destZip - destCity.min) * 0.6,
    destZip - margin,
    distanceStart - margin,
    weightCluster.min - margin,
    weightCluster.min + 0.048,
    1
  ];
  return columns.every((value, index) => index === 0 || value > columns[index - 1]) ? columns : null;
}

function detectScreenshotColumns(lines, imageWidth) {
  const allWords = lines.flatMap(line => line.words || []);
  return detectColumnsFromHeader(allWords, imageWidth)
    || detectColumnsFromData(allWords, imageWidth)
    || screenshotColumns;
}

function detectColumnsFromHeader(allWords, imageWidth) {
  const orderHeader = allWords
    .filter(word => /^order$/i.test(word.text))
    .sort((a, b) => a.bbox.y0 - b.bbox.y0)[0];
  if (!orderHeader) return null;

  const headerY = (orderHeader.bbox.y0 + orderHeader.bbox.y1) / 2;
  const tolerance = (orderHeader.bbox.y1 - orderHeader.bbox.y0) * 0.5;
  const headerWords = allWords
    .filter(word => Math.abs((word.bbox.y0 + word.bbox.y1) / 2 - headerY) <= tolerance)
    .sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const find = pattern => headerWords.filter(word => pattern.test(word.text.replace(/[^A-Za-z]/g, '')));
  const origin = find(/^origin./i)[0];
  const dest = find(/^destc/i)[0];
  const distance = find(/^dist/i)[0];
  const weight = find(/^weigh/i)[0];
  const planning = find(/^plan/i)[0];
  if (!origin || !dest || !distance || !weight || !planning) return null;
  const dateHeaders = headerWords.filter(word =>
    word.bbox.x0 > orderHeader.bbox.x1 && word.bbox.x1 <= origin.bbox.x0 + 1
  );
  if (dateHeaders.length !== 4) return null;
  const [early, late, earlyDelivery, lateDelivery] = dateHeaders;
  const start = word => Math.max(0, word.bbox.x0 / imageWidth - 0.004);
  const originStart = start(origin);
  const destStart = start(dest);
  const distanceStart = start(distance);
  const originSpan = destStart - originStart;
  const destSpan = distanceStart - destStart;
  const columns = [
    0,
    start(orderHeader),
    start(early),
    start(late),
    start(earlyDelivery),
    start(lateDelivery),
    originStart,
    originStart + originSpan * 0.57,
    originStart + originSpan * 0.76,
    destStart,
    destStart + destSpan * 0.46,
    destStart + destSpan * 0.65,
    distanceStart,
    start(weight),
    start(planning),
    1
  ];
  return columns.every((value, index) => index === 0 || value > columns[index - 1])
    ? columns
    : null;
}

function parseWeightPounds(value) {
  const normalized = String(value ?? '').trim().replace(/,/g, '');
  const match = normalized.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const pounds = Number(match[0]);
  return Number.isFinite(pounds) && pounds > 0 ? Math.round(pounds) : null;
}

function parseScreenshotLines(lines, imageWidth, imageHeight, selectedBroker) {
  const cleanCell = value => value
    .replace(/[|[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parseWeight = value => {
    return String(parseWeightPounds(value) || '');
  };
  const parseDateTime = (value, fallbackDate = '') => {
    const text = String(value || '').trim();
    const dateMatch = text.match(/\b(1[0-2]|0?[1-9])\s*[/.-]\s*(3[01]|[12]\d|0?[1-9])\s*[/.-]\s*(20\d{2}|\d{2})\b/);
    const fallbackMatch = String(fallbackDate || '').match(/\b(1[0-2]|0?[1-9])\s*[/.-]\s*(3[01]|[12]\d|0?[1-9])\s*[/.-]\s*(20\d{2}|\d{2})\b/);
    const date = dateMatch || fallbackMatch;
    if (!date) return '';

    const [, month, day, yearText] = date;
    const year = yearText.length === 2 ? `20${yearText}` : yearText;
    const timeText = dateMatch ? text.slice(dateMatch.index + dateMatch[0].length).trim() : text;
    const timeMatch = timeText.match(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\b/i)
      || timeText.match(/\b(\d{3,4})\b/);
    if (!timeMatch) return `${month}/${day}/${year} 0000`;

    let hour;
    let minute;
    const [, hourText, minuteText, meridiem] = timeMatch;
    if (minuteText !== undefined) {
      hour = Number(hourText);
      minute = Number(minuteText);
    } else {
      const digits = hourText.padStart(4, '0');
      hour = Number(digits.slice(0, -2));
      minute = Number(digits.slice(-2));
    }
    if (meridiem) {
      if (hour < 1 || hour > 12) return '';
      hour = hour % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
    }
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), hour, minute));
    if (parsed.getUTCFullYear() !== Number(year)
      || parsed.getUTCMonth() !== Number(month) - 1
      || parsed.getUTCDate() !== Number(day)
      || hour > 23
      || minute > 59) return '';
    return `${month}/${day}/${year} ${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`;
  };
  const shortDateTime = value => value.replace(/^(\d{1,2})\/(\d{1,2})\/\d{4}/, '$1/$2');
  
  const parseState = value => {
    const cleanVal = String(value || '').replace(/[^A-Za-z]/g, '').toUpperCase();
    if (stateCodes.has(cleanVal)) return cleanVal;
    if (cleanVal.length > 2 && stateCodes.has(cleanVal.slice(-2))) return cleanVal.slice(-2);
    return Array.from(cleanVal.matchAll(/[A-Z]{2}/g)).map(match => match[0]).reverse().find(code => stateCodes.has(code)) || '';
  };

  const columns = detectScreenshotColumns(lines, imageWidth);
  return lines.map((line, index) => {
    if (line.bbox.y0 < imageHeight * 0.035) return null;
    const cells = Array.from({ length: columns.length - 1 }, () => []);
    line.words.forEach(word => {
      const x = (word.bbox.x0 + word.bbox.x1) / 2 / imageWidth;
      const column = columns.findIndex((boundary, cellIndex) => x >= boundary && x < columns[cellIndex + 1]);
      if (column >= 0) cells[column].push(word);
    });

    const values = cells.map(cell => cleanCell(cell.sort((a, b) => a.bbox.x0 - b.bbox.x0).map(word => word.text).join(' ')));
    const [equipmentText, orderText, earlyPickup, latePickup, earlyDelivery, lateDelivery, origCity, origSt, origZip, destCity, destSt, destZip, miles, weight, planningComment] = values;
    const numberText = orderText.replace(/\D/g, '');
    const orderMatch = numberText.match(/22\d{5}/)?.[0];
    const id = line.verifiedOrderId || orderMatch || '';
    const equipment = equipmentText.toUpperCase().match(/\b(VZ|VE|VR|RZ|R|F|SD|VAN)\b/)?.[0] || '';
    const rowText = line.text.toLowerCase();
    if (/distance/.test(rowText) && /weight/.test(rowText) && /comment/.test(rowText)) return null;
    if (/\border\b/.test(rowText) && /\bearly\b/.test(rowText) && /\blate\b/.test(rowText)) return null;
    if (!origCity || !destCity) return null;

    const pickupFrom = parseDateTime(earlyPickup);
    const pickupTo = parseDateTime(latePickup, earlyPickup);
    const deliveryFrom = parseDateTime(earlyDelivery);
    const deliveryTo = parseDateTime(lateDelivery, earlyDelivery);
    const mileageDigits = miles.replace(/\D/g, '');
    const rawDecimalMiles = miles.replace(/\s/g, '').match(/\d{1,6}\.\d/)?.[0];
    // Distance is never above 9999 miles, so extra leading digits are bleed from the neighboring cell.
    const decimalMiles = rawDecimalMiles && rawDecimalMiles.split('.')[0].length >= 5
      ? `${rawDecimalMiles.slice(0, 3)}.${rawDecimalMiles.slice(-1)}`
      : rawDecimalMiles;
    const mergedMiles = !decimalMiles && mileageDigits.length >= 7
      ? mileageDigits.slice(0, -6)
      : '';
    const mileage = mergedMiles
      ? `${mergedMiles}.0`
      : decimalMiles
      ? decimalMiles
      : miles.includes('.')
        ? miles.replace(/[^0-9.]/g, '')
      : mileageDigits.length === 4 || mileageDigits.length === 5
        ? `${mileageDigits.slice(0, -1)}.${mileageDigits.slice(-1)}`
        : mileageDigits;
    const normalizeCity = (city, stateText) => {
      let normalizedCity = city.toUpperCase().replace(/[^A-Z\s.'-]/g, '').trim();
      let state = parseState(stateText);
      const trailingState = normalizedCity.match(/\s+([A-Z]{2})$/)?.[1];
      if (trailingState && stateCodes.has(trailingState)) {
        state ||= trailingState;
        normalizedCity = normalizedCity.slice(0, -trailingState.length).trim();
      } else if (!state) {
        const gluedState = normalizedCity.match(/^(.{3,}?)[.\s]*I?([A-Z]{2})$/);
        if (gluedState && stateCodes.has(gluedState[2])) {
          normalizedCity = gluedState[1].replace(/\.+$/, '').trim();
          state = gluedState[2];
        }
      }
      return { city: normalizedCity, state };
    };
    const normalizedOrigin = normalizeCity(origCity, origSt);
    const normalizedDestination = normalizeCity(destCity, destSt);
    const origin = normalizedOrigin.city;
    const destination = normalizedDestination.city;
    const originState = normalizedOrigin.state;
    const destinationState = normalizedDestination.state;
    const originZipcode = origZip.replace(/\D/g, '').match(/\d{5}/)?.[0] || '';
    const destinationZipcode = destZip.replace(/\D/g, '').match(/\d{5}/)?.[0] || '';
    const positionedWeightText = line.words
      .filter(word => {
        const center = (word.bbox.x0 + word.bbox.x1) / 2 / imageWidth;
        return center >= columns[13] && center < columns[14];
      })
      .sort((a, b) => a.bbox.x0 - b.bbox.x0)
      .map(word => word.text)
      .join(' ');
    const weightFromComment = parseWeight(planningComment.match(/^\s*(\d[\d,. ]{2,8})/)?.[1]);
    const weightFromLabel = parseWeight(
      line.text.match(/\b(\d[\d,. ]{2,8})\s*(?:lbs?|pounds)\b/i)?.[1]
    );
    const rawWeight = parseWeight(weight)
      || parseWeight(positionedWeightText)
      || weightFromComment
      || weightFromLabel;
    // A grid line next to the weight cell is often read as a leading "1".
    const weightValue = /^1\d{5}$/.test(rawWeight) && Number(rawWeight.slice(1)) >= 1000
      ? rawWeight.slice(1)
      : rawWeight;
    const normalizedComment = weightFromComment
      ? planningComment.replace(/^\s*\d[\d,. ]{2,8}\s*/, '').trim()
      : planningComment;

    return {
      id: id || `IMG-${Date.now()}-${index}`,
      postingCode: 'ANQ',
      visibilityGroup: 'ANQ',
      eCode: equipment || (isRxoCustomer(selectedBroker) ? 'VAN:VAN' : 'VZ'),
      status: 'OPEN',
      tag: 'OPEN',
      route: `${origin}${originState ? `, ${originState}` : ''} → ${destination}${destinationState ? `, ${destinationState}` : ''}`,
      puDate: pickupFrom || pickupTo ? `PU: ${shortDateTime(pickupFrom || pickupTo)}` : 'PU: Today',
      delDate: deliveryTo || deliveryFrom ? `DFL: ${shortDateTime(deliveryTo || deliveryFrom)}` : 'DFL: Upcoming',
      pickupTime: pickupFrom && pickupTo ? `${pickupFrom} - ${pickupTo}` : pickupFrom || pickupTo || '10/19/2026 0800 - 1700',
      origCity: origin,
      origSt: originState,
      origZip: originZipcode,
      weight: weightValue ? `${weightValue} lbs` : '40000 lbs',
      deliveryTime: deliveryFrom && deliveryTo ? `${deliveryFrom} - ${deliveryTo}` : deliveryFrom || deliveryTo || '10/21/2026 0800 - 1700',
      destCity: destination,
      destSt: destinationState,
      destZip: destinationZipcode,
      miles: mileage || '400',
      planningComment: normalizedComment,
      carrier: '',
      driver: '',
      truck: '',
      trailer: '',
      rateInput: '',
      brokerable: 'false',
      notes: id && originState ? '' : 'Some fields were unreadable from the screenshot; please verify state codes and times.'
    };
  }).filter(Boolean);
}

// NTG load-board cards: each card has the load #, origin/destination with dates, miles, weight and total rate.
function parseNtgScreenshotLines(lines, imageWidth, imageHeight) {
  const words = lines.flatMap(line => line.words || [])
    .map(word => {
      const x0 = word.bbox.x0 / imageWidth;
      const x1 = word.bbox.x1 / imageWidth;
      return { text: String(word.text || '').trim(), x0, x1, cx: (x0 + x1) / 2, cy: (word.bbox.y0 + word.bbox.y1) / 2, h: word.bbox.y1 - word.bbox.y0 };
    })
    .filter(word => word.text);
  const anchors = words
    .filter(word => /^load$/i.test(word.text) && word.x0 < 0.2)
    .sort((a, b) => a.cy - b.cy);
  const anchorSpacing = anchors.length > 1
    ? anchors.slice(1).map((anchor, index) => anchor.cy - anchors[index].cy).sort((a, b) => a - b)[Math.floor((anchors.length - 1) / 2)]
    : imageHeight;
  const toRows = region => {
    const rows = [];
    region.slice().sort((a, b) => a.cy - b.cy).forEach(word => {
      const row = rows[rows.length - 1];
      if (row && Math.abs(word.cy - row.cy) < Math.max(6, word.h * 0.6)) {
        row.words.push(word);
        row.cy = row.words.reduce((sum, item) => sum + item.cy, 0) / row.words.length;
      } else {
        rows.push({ cy: word.cy, words: [word] });
      }
    });
    return rows.map(row => ({ ...row, text: row.words.sort((a, b) => a.x0 - b.x0).map(word => word.text).join(' ') }));
  };
  const parseCity = text => {
    const match = text.replace(/[|]/g, '').match(/^(.*?)[,.]?\s+([A-Za-z]{2})$/);
    const state = match?.[2].toUpperCase();
    if (!match || !stateCodes.has(state)) return null;
    const city = match[1].replace(/[^A-Za-z\s.'-]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
    return city ? { city, state } : null;
  };
  const parseDates = text => {
    const cleaned = text.replace(/[Oo]/g, '0');
    const dateMatch = cleaned.match(/(1[0-2]|0?[1-9])\s*\/\s*(3[01]|[12]\d|0?[1-9])\s*\/\s*(20\d{2}|\d{2})/);
    if (!dateMatch) return '';
    const date = `${dateMatch[1].padStart(2, '0')}/${dateMatch[2].padStart(2, '0')}/${dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3]}`;
    const times = Array.from(cleaned.slice(dateMatch.index + dateMatch[0].length).matchAll(/(\d{1,2})\s*:\s*(\d{2})/g))
      .map(match => `${match[1].padStart(2, '0')}${match[2]}`);
    const start = times[0] || '0800';
    const end = times[1] || (times[0] ? times[0] : '1600');
    return `${date} ${start} - ${end}`;
  };

  return anchors.map((anchor, index) => {
    const top = anchor.cy - anchorSpacing * 0.3;
    const bottom = anchor.cy + anchorSpacing * 0.7;
    const card = words.filter(word => word.cy >= top && word.cy < bottom);
    const idWord = card.find(word => word.x0 < 0.2 && /^\d{7}$/.test(word.text));
    const milesWord = card.find(word => /miles?$/i.test(word.text));
    const centerX = milesWord ? milesWord.cx : 0.45;
    let mileage = milesWord?.text.match(/(\d{2,5})\s*miles?/i)?.[1] || '';
    if (milesWord && !mileage) {
      mileage = card
        .filter(word => /^\D{0,2}\d{2,5}$/.test(word.text) && Math.abs(word.cy - milesWord.cy) < milesWord.h && word.x1 <= milesWord.x0 + 0.01 && word.x0 > milesWord.x0 - 0.08)
        .sort((a, b) => b.x1 - a.x1)[0]?.text.replace(/\D/g, '') || '';
    }
    const statsLeft = (card.find(word => /^stops$/i.test(word.text))?.x0 ?? 0.69) - 0.02;
    const rateWord = card.find(word => /^\$\s*[\d,]+(\.\d+)?$/.test(word.text));
    const rate = rateWord ? rateWord.text.replace(/[^0-9.]/g, '') : '';
    const weightWord = card
      .filter(word => word.cx >= statsLeft && word !== rateWord && /^(\d{1,3}(,\d{3})+|\d{4,6})(\.\d+)?$/.test(word.text))
      .sort((a, b) => a.x0 - b.x0)[0];
    const weight = weightWord ? String(Math.round(Number(weightWord.text.replace(/,/g, '')))) : '';

    const originRows = toRows(card.filter(word => word.x0 > 0.08 && word.cx < centerX - 0.06));
    const destRows = toRows(card.filter(word => word.cx > centerX + 0.06 && word.cx < statsLeft));
    const findLocation = rows => {
      const rowIndex = rows.findIndex(row => parseCity(row.text));
      return rowIndex < 0 ? { location: null, dates: '' } : {
        location: parseCity(rows[rowIndex].text),
        dates: parseDates(rows[rowIndex + 1]?.text || '')
      };
    };
    const origin = findLocation(originRows);
    const destination = findLocation(destRows);
    if (!origin.location || !destination.location) return null;

    const equipmentText = card.map(word => word.text).join(' ');
    const isReefer = /reefer/i.test(equipmentText);
    const tags = [/hazmat/i.test(equipmentText) && 'Hazmat', /tanker/i.test(equipmentText) && 'Tanker (N) Endorsement'].filter(Boolean);
    const shortDate = value => value.replace(/^(\d{2})\/(\d{2})\/\d{4}\s+(\d{4}).*$/, '$1/$2 $3');
    return {
      id: idWord ? idWord.text : `NTG-${Date.now()}-${index}`,
      postingCode: 'ANQ',
      visibilityGroup: 'ANQ',
      eCode: isReefer ? 'VR' : 'VZ',
      status: 'OPEN',
      tag: 'OPEN',
      route: `${origin.location.city}, ${origin.location.state} → ${destination.location.city}, ${destination.location.state}`,
      puDate: origin.dates ? `PU: ${shortDate(origin.dates)}` : 'PU: Today',
      delDate: destination.dates ? `DFL: ${shortDate(destination.dates)}` : 'DFL: Upcoming',
      pickupTime: origin.dates,
      origCity: origin.location.city,
      origSt: origin.location.state,
      origZip: '',
      weight: weight ? `${weight} lbs` : '',
      deliveryTime: destination.dates,
      destCity: destination.location.city,
      destSt: destination.location.state,
      destZip: '',
      miles: mileage,
      planningComment: tags.join(', '),
      carrier: '',
      driver: '',
      truck: '',
      trailer: '',
      rateInput: rate,
      rateSource: rate ? 'user-entered' : undefined,
      brokerable: 'false',
      notes: idWord ? '' : 'Load number was unreadable from the NTG screenshot; please enter it.'
    };
  }).filter(Boolean);
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

// DAT screenshots have no ZIPs, so garbled city names are matched against the real cities of the state.
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

// Landstar truncates long city names ("NEWPORT NE...") and OCR drops letters; the ZIP's city fixes both.
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
    const zipCity = normalize(location.city);
    if (load[stateKey] && load[stateKey] !== location.state) return;
    const similar = ocrCity.length >= 3 && (
      zipCity.startsWith(ocrCity)
      || editDistance(zipCity, ocrCity) <= Math.max(1, Math.floor(zipCity.length / 6))
    );
    if (!similar && ocrCity) return;
    load[cityKey] = String(location.city).toUpperCase();
    load[stateKey] = location.state;
  };
  loads.forEach(load => {
    fix(load, 'origCity', 'origSt', 'origZip');
    fix(load, 'destCity', 'destSt', 'destZip');
    load.route = `${load.origCity}${load.origSt ? `, ${load.origSt}` : ''} → ${load.destCity}${load.destSt ? `, ${load.destSt}` : ''}`;
  });
  return loads;
}

function parseDatScreenshotLines(lines, imageWidth, imageHeight, selectedBroker, laneRates) {
  const cleanCell = words => words
    .sort((a, b) => a.bbox.x0 - b.bbox.x0)
    .map(word => word.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const headerCenters = {};
  const headerPatterns = {
    rate: /^rate/i,
    trip: /^trip$/i,
    origin: /^origin$/i,
    destination: /^destination$/i,
    pickup: /^pick(?:up)?$/i,
    equipment: /^eq$/i,
    weight: /^weight$/i
  };
  const allWords = lines.flatMap(line => line.words || []);
  const headerWords = {};
  Object.entries(headerPatterns).forEach(([field, pattern]) => {
    headerWords[field] = allWords
      .filter(word => pattern.test(word.text))
      .sort((a, b) => a.bbox.y0 - b.bbox.y0)[0];
    if (headerWords[field]) {
      headerCenters[field] = (headerWords[field].bbox.x0 + headerWords[field].bbox.x1) / 2 / imageWidth;
    }
  });
  const headerFields = Object.keys(headerCenters)
    .sort((a, b) => headerCenters[a] - headerCenters[b]);
  const getHeaderCell = (line, field) => {
    const fieldIndex = headerFields.indexOf(field);
    if (fieldIndex < 0) return '';
    const center = headerCenters[field];
    const left = fieldIndex === 0
      ? 0
      : (headerCenters[headerFields[fieldIndex - 1]] + center) / 2;
    const right = fieldIndex === headerFields.length - 1
      ? 1
      : (center + headerCenters[headerFields[fieldIndex + 1]]) / 2;
    return cleanCell(line.words.filter(word => {
      const wordCenter = (word.bbox.x0 + word.bbox.x1) / 2 / imageWidth;
      return wordCenter >= left && wordCenter < right;
    }));
  };
  const getCellBounds = field => {
    const fieldIndex = headerFields.indexOf(field);
    if (fieldIndex < 0) return null;
    const center = headerCenters[field];
    return {
      left: fieldIndex === 0 ? 0 : (headerCenters[headerFields[fieldIndex - 1]] + center) / 2,
      right: fieldIndex === headerFields.length - 1
        ? 1
        : (center + headerCenters[headerFields[fieldIndex + 1]]) / 2
    };
  };
  const tripBounds = getCellBounds('trip');
  const rateBounds = getCellBounds('rate');
  const tripHeaderY = headerWords.trip
    ? (headerWords.trip.bbox.y0 + headerWords.trip.bbox.y1) / 2
    : 0;
  const tripAnchors = tripBounds
    ? allWords.filter(word => {
      const centerX = (word.bbox.x0 + word.bbox.x1) / 2 / imageWidth;
      const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
      return centerX >= tripBounds.left
        && centerX < tripBounds.right
        && centerY > tripHeaderY
        && /^\d{2,5}$/.test(word.text.replace(/[Oo]/g, '0'));
    }).sort((a, b) => a.bbox.y0 - b.bbox.y0)
    : [];
  const pickupHeaderY = headerWords.pickup
    ? (headerWords.pickup.bbox.y0 + headerWords.pickup.bbox.y1) / 2
    : tripHeaderY;
  const pickupDateAnchors = allWords.filter(word => {
    const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
    const text = word.text.replace(/[Oo]/g, '0');
    return centerY > pickupHeaderY
      && /\b(?:0?[1-9]|1[0-2])\s*[/.-]\s*(?:0?[1-9]|[12]\d|3[01])(?:\s*[/.-]\s*\d{2,4})?\b/.test(text);
  }).sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const datRows = [];
  const rowTolerance = Math.max(8, Math.min(imageHeight * 0.02, imageHeight * 0.035));
  const rowAnchors = tripAnchors.length ? tripAnchors : pickupDateAnchors;
  rowAnchors.forEach(anchor => {
    const centerY = (anchor.bbox.y0 + anchor.bbox.y1) / 2;
    const previous = datRows[datRows.length - 1];
    if (previous && Math.abs(previous.centerY - centerY) < rowTolerance * 0.5) return;
    const words = allWords.filter(word =>
      Math.abs((word.bbox.y0 + word.bbox.y1) / 2 - centerY) <= rowTolerance
    );
    datRows.push({
      words,
      text: words.map(word => word.text).join(' '),
      bbox: { y0: centerY - rowTolerance, y1: centerY + rowTolerance },
      trip: tripAnchors.length ? anchor.text.replace(/[Oo]/g, '0') : ''
    });
  });
  const rowsToRead = datRows.length ? datRows : lines;
  const rowEquipment = line => {
    const fromCell = getHeaderCell(line, 'equipment').toUpperCase().replace(/^VV$/, 'V')
      .match(/\b(VT|VAN|V|R|F|SD|VR|RZ|VZ|VE|FH)\b/)?.[0];
    if (fromCell) return fromCell;
    const date = line.text.match(/\b(?:1[0-2]|0?[1-9])\s*[/.-]\s*(?:3[01]|[12]\d|0?[1-9])\b/);
    return date
      ? line.text.slice(date.index + date[0].length).toUpperCase()
        .match(/\b(VT|VAN|VV|V|R|F|SD|VR|RZ|VZ|VE|FH)\b/)?.[0]?.replace(/^VV$/, 'V') || ''
      : '';
  };
  const equipmentCounts = rowsToRead
    .map(rowEquipment)
    .filter(Boolean)
    .reduce((counts, equipment) => ({
      ...counts,
      [equipment]: (counts[equipment] || 0) + 1
    }), {});
  const [dominantEquipment, dominantEquipmentCount] = Object.entries(equipmentCounts)
    .sort((a, b) => b[1] - a[1])[0] || ['', 0];
  const reliableDominantEquipment = dominantEquipmentCount >= 3
    && dominantEquipmentCount / Object.values(equipmentCounts).reduce((total, count) => total + count, 0) >= 0.8
    ? dominantEquipment
    : '';
  const rateObservations = lines.flatMap(line => {
    const rateText = line.text.replace(/\$\s*[\d,.]+[^A-Za-z0-9]*\/\s*mi\b/gi, '');
    const match = rateText.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
    const rate = Number(match?.[1].replace(/,/g, ''));
    return rate > 0
      ? [{ y: (line.bbox.y0 + line.bbox.y1) / 2, rate }]
      : [];
  });
  const getLocation = value => {
    const match = value.match(/^(.*?)[,\s]+([A-Z]{2})$/i);
    if (!match || !stateCodes.has(match[2].toUpperCase())) return null;
    const city = match[1]
      .replace(/^[A-Za-z0]{1,2}\s*[-=>»|]+\s*/, '')
      .replace(/^([NSEW])(?=[A-Z][a-z]{2,})/, '$1 ')
      .replace(/^[Oo0]\s+(?=[A-Z])/, '')
      .replace(/[^\w\s.'-]/g, '')
      .trim()
      .toUpperCase();
    const tokens = city.split(/\s+/).filter(Boolean);
    const cleanedTokens = tokens.filter((token, tokenIndex) =>
      !tokens.some((other, otherIndex) =>
        otherIndex !== tokenIndex
        && token.length >= 4
        && (other.length > token.length || (other.length === token.length && otherIndex < tokenIndex))
        && other.includes(token))
      && !(tokenIndex === tokens.length - 1 && tokenIndex > 0 && token.replace(/[^A-Z]/g, '').length <= 2)
    );
    const finalCity = cleanedTokens.join(' ').replace(/[^\w\s.'-]/g, '').trim();
    return finalCity ? { city: finalCity, state: match[2].toUpperCase() } : null;
  };
  const monthCounts = {};
  allWords.forEach(word => {
    const found = word.text.replace(/[Oo]/g, '0').match(/^(1[0-2]|[1-9])\/(3[01]|[12]\d|0?[1-9])$/);
    if (found) monthCounts[found[1]] = (monthCounts[found[1]] || 0) + 1;
  });
  const commonMonth = Number(Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0]?.[0]) || new Date().getMonth() + 1;
  const getDate = value => {
    const cleaned = value.replace(/[Oo]/g, '0').trim();
    const match = cleaned.match(/\b(1[0-2]|0?[1-9])\s*[/.-]\s*(3[01]|[12]\d|0?[1-9])\b/)
      || cleaned.match(/^(1[0-2])(0[1-9]|[12]\d|3[01])$/)
      || cleaned.match(/(?:^|\s)0\s*\/\s*(3[01]|[12]\d|0?[1-9])\b/);
    if (!match) return '';
    const isMissingMonth = match.length === 2;
    const month = isMissingMonth ? commonMonth : Number(match[1]);
    const day = Number(isMissingMonth ? match[1] : match[2]);
    const year = new Date().getFullYear();
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
    return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
  };
  const getTextRow = text => {
    const normalizedText = String(text || '')
      .replace(/[Oo](?=\d)/g, '0')
      .replace(/[IlM1|]bs\b/g, ' lbs');
    const dateMatch = normalizedText.match(/\b(1[0-2]|0?[1-9])\s*[/.-]\s*(3[01]|[12]\d|0?[1-9])\b/);
    if (!dateMatch) return null;
    const prefix = normalizedText.slice(0, dateMatch.index);
    const stateMatches = Array.from(prefix.matchAll(/\b([A-Z]{2})\b/gi))
      .filter(match => stateCodes.has(match[1].toUpperCase()));
    if (stateMatches.length < 2) return null;

    const originStateMatch = stateMatches[0];
    const destinationStateMatch = stateMatches[1];
    const originPrefix = prefix.slice(0, originStateMatch.index);
    const tripNumberMatches = Array.from(originPrefix.matchAll(/\b\d{3,8}\s+/g));
    const originText = tripNumberMatches.length
      ? originPrefix.slice(tripNumberMatches[tripNumberMatches.length - 1].index + tripNumberMatches[tripNumberMatches.length - 1][0].length)
      : originPrefix;
    const originCity = originText.replace(/[^A-Z\s.'-]/gi, ' ').replace(/\s+/g, ' ').trim();
    const destinationCity = prefix
      .slice(originStateMatch.index + originStateMatch[0].length, destinationStateMatch.index)
      .replace(/[^A-Z\s.'-]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const tail = normalizedText.slice(dateMatch.index + dateMatch[0].length);
    const equipment = tail.match(/\b(VT|VAN|VV|V|R|F|SD|VR|RZ|VZ|VE|FH)\b/i)?.[0]?.toUpperCase().replace(/^VV$/, 'V') || '';
    const weight = normalizedText.match(/([\d][\d,.]*)\s*lbs?\b/i)?.[1] || '';
    const origin = getLocation(`${originCity}, ${originStateMatch[1]}`);
    const destination = getLocation(`${destinationCity}, ${destinationStateMatch[1]}`);
    const pickupDate = getDate(dateMatch[0]);
    if (!origin || !destination || !pickupDate || !equipment || !(Number(weight.replace(/,/g, '')) > 0)) return null;
    return { origin, destination, pickupDate, equipment, weightRaw: weight };
  };
  const loads = [];
  rowsToRead.forEach((line, index) => {
    if (!line.words?.length || line.bbox.y0 < imageHeight * 0.035) return;
    const textRow = getTextRow(line.text);
    const origin = getLocation(getHeaderCell(line, 'origin')) || textRow?.origin;
    const destination = getLocation(getHeaderCell(line, 'destination')) || textRow?.destination;
    const pickupDate = getDate(getHeaderCell(line, 'pickup')) || textRow?.pickupDate || '';
    const equipmentText = getHeaderCell(line, 'equipment').toUpperCase().replace(/^VV$/, 'V');
    const equipment = equipmentText.match(/\b(VT|VAN|V|R|F|SD|VR|RZ|VZ|VE|FH)\b/)?.[0]
      || textRow?.equipment
      || reliableDominantEquipment;
    const weightText = getHeaderCell(line, 'weight').replace(/[Oo]/g, '0').replace(/[IlM1|]bs\b/g, ' lbs');
    const rawWeight = weightText.match(/(\d[\d,.]*)\s*lbs?\b/i)?.[1]
      || weightText.match(/\d[\d,.]*/)?.[0]
      || textRow?.weightRaw
      || '';
    const weight = rawWeight.replace(/^(\d{1,3},\d{3})\d$/, '$1').replace(/,/g, '');
    const trip = line.trip || getHeaderCell(line, 'trip').replace(/[Oo]/g, '0').match(/\b\d{2,5}\b/)?.[0] || '';
    const positionedRateWords = rateBounds
      ? allWords.filter(word => {
        const centerX = (word.bbox.x0 + word.bbox.x1) / 2 / imageWidth;
        const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
        const rowCenter = (line.bbox.y0 + line.bbox.y1) / 2;
        return centerX >= rateBounds.left
          && centerX < rateBounds.right
          && Math.abs(centerY - rowCenter) <= rowTolerance;
      })
        .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)
      : [];
    const positionedRateLines = [];
    positionedRateWords.forEach(word => {
      const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
      const previousLine = positionedRateLines[positionedRateLines.length - 1];
      if (previousLine && Math.abs(previousLine.centerY - centerY) <= rowTolerance * 0.25) {
        previousLine.words.push(word);
      } else {
        positionedRateLines.push({ centerY, words: [word] });
      }
    });
    const positionedRate = positionedRateLines
      .map(rateLine => cleanCell(rateLine.words))
      .filter(rateLine => !/\/\s*mi\b/i.test(rateLine))
      .map(rateLine => Number(
        rateLine.replace(/,/g, '').match(/(?:\$\s*)?(\d{3,})\b/)?.[1] || 0
      ))
      .find(rateValue => rateValue >= 100) || 0;
    const rateText = getHeaderCell(line, 'rate');
    const directRate = /\$/.test(rateText)
      ? Number(rateText.replace(/,/g, '').match(/\d{3,}(?:\.\d{1,2})?/)?.[0] || 0)
      : 0;
    const rowCenter = (line.bbox.y0 + line.bbox.y1) / 2;
    const nearestRate = rateObservations
      .map(observation => ({ ...observation, distance: Math.abs(observation.y - rowCenter) }))
      .filter(observation => observation.distance <= imageHeight * 0.045)
      .sort((a, b) => a.distance - b.distance)[0];
    const rate = positionedRate || directRate || nearestRate?.rate || 0;
    if (!origin || !destination || !pickupDate || !equipment || !(Number(weight?.replace(/,/g, '')) > 0)) return;
    if (!line.text.trim()) return;

    const order = {
      id: `DAT-${Date.now()}-${index}`,
      postingCode: 'ANQ',
      visibilityGroup: 'ANQ',
      eCode: equipment,
      team: equipment === 'VT' ? 'true' : 'false',
      status: 'OPEN',
      tag: 'OPEN',
      route: `${origin.city}, ${origin.state} → ${destination.city}, ${destination.state}`,
      puDate: `PU: ${pickupDate}`,
      delDate: 'DFL: Upcoming',
      pickupTime: `${pickupDate} 0800 - 1600`,
      origCity: origin.city,
      origSt: origin.state,
      origZip: '',
      weight: `${weight} lbs`,
      deliveryTime: String(selectedBroker || '').includes('965974') ? '' : '0800 - 1600',
      destCity: destination.city,
      destSt: destination.state,
      destZip: '',
      miles: trip,
      planningComment: 'Imported from DAT screenshot',
      carrier: '',
      driver: '',
      truck: '',
      trailer: '',
      rateInput: rate > 0 ? String(rate) : '',
      ...(rate > 0 ? { rateSource: 'dat-screenshot' } : {}),
      brokerable: 'false',
      rateCrop: { centerY: (line.bbox.y0 + line.bbox.y1) / 2 },
      notes: `DAT screenshot does not include ZIP codes. ${trip ? 'Trip value was imported as miles; verify it.' : 'Trip miles were not recognized; enter them before export.'}`
    };
    const laneRateKey = createLaneRateKey(selectedBroker, order);
    const savedLaneRate = laneRateKey ? laneRates[laneRateKey] : '';
    if (!order.rateInput && savedLaneRate) {
      order.rateInput = savedLaneRate;
      order.rateSource = 'user-entered';
    }
    loads.push(order);
  });
  const lanes = {};
  loads.forEach(load => {
    const key = `${load.origCity}|${load.origSt}|${load.destCity}|${load.destSt}`;
    (lanes[key] = lanes[key] || []).push(load);
  });
  Object.values(lanes).forEach(group => {
    const counts = {};
    group.forEach(load => { if (load.miles) counts[load.miles] = (counts[load.miles] || 0) + 1; });
    const [common, commonCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || ['', 0];
    if (commonCount < 2) return;
    group.forEach(load => {
      if (load.miles !== common && editDistance(load.miles, common) <= 1) load.miles = common;
    });
  });
  const rowCenters = loads.map(load => load.rateCrop.centerY).sort((a, b) => a - b);
  const spacings = rowCenters.slice(1).map((center, index) => center - rowCenters[index]).filter(gap => gap > 10).sort((a, b) => a - b);
  const rowHeight = spacings[Math.floor(spacings.length / 2)] || imageHeight * 0.06;
  const tripLeft = headerWords.trip
    ? headerWords.trip.bbox.x0
    : (tripAnchors.length ? Math.min(...tripAnchors.map(word => word.bbox.x0)) : imageWidth * 0.1);
  const rateRight = tripLeft * 0.71;
  loads.forEach(load => {
    const { centerY } = load.rateCrop;
    load.rateCrop = { centerY, rowHeight, x0: 0, x1: Math.round(rateRight) };
  });
  return loads;
}

function getEquipmentDescription(eCode) {
  const code = eCode?.trim().toUpperCase();
  switch (code) {
    case 'VZ': return 'VAN:VAN, VAN:53VN, REFR:REFR';
    case 'VAN':
    case 'V': return 'VAN:VAN, VAN:53VN';
    case 'VT': return 'VAN:VAN, VAN:53VN';
    case 'VR': return 'VAN:VAN, REFR:REFR';
    case 'R': return 'REFR:REFR';
    case 'RZ': return 'REFR:REFR';
    case 'F': return 'FLAT:53FL, FLAT:48FL, FLAT:FLAT, STEP:SD';
    case 'SD': return 'STEP:SD';
    default: return eCode || 'VAN:VAN';
  }
}

function formatExcelDateTime(val) {
  if (val == null || val === '') return '10/18/2026 0800 - 1200';
  if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
    return formatRxoExcelDateTime(val);
  }
  const str = String(val).trim();
  if (/^\d+(?:\.\d+)?$/.test(str) && Number(str) >= 10000) {
    return formatRxoExcelDateTime(Number(str));
  }
  return str;
}

function formatRxoExcelDateTime(value) {
  const text = String(value ?? '').trim();
  let date;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    date = new Date(Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
      value.getUTCHours(),
      value.getUTCMinutes()
    ));
  } else if (
    (typeof value === 'number' && Number.isFinite(value) && value >= 0)
    || (/^\d+(?:\.\d+)?$/.test(text) && Number(text) >= 0)
  ) {
    const serial = Number(value);
    date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000));
  } else {
    const usDateTime = text.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):?(\d{2})\s*(AM|PM)?$/i
    );
    const isoDateTime = text.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/
    );
    if (!usDateTime && !isoDateTime) return text;

    const month = Number(usDateTime ? usDateTime[1] : isoDateTime[2]);
    const day = Number(usDateTime ? usDateTime[2] : isoDateTime[3]);
    const yearText = usDateTime ? usDateTime[3] : isoDateTime[1];
    const year = Number(yearText) < 100 ? 2000 + Number(yearText) : Number(yearText);
    let hour = Number(usDateTime ? usDateTime[4] : isoDateTime[4]);
    const minute = Number(usDateTime ? usDateTime[5] : isoDateTime[5]);
    const meridiem = usDateTime?.[6]?.toUpperCase();
    if (meridiem) {
      if (hour < 1 || hour > 12) return text;
      hour = hour % 12 + (meridiem === 'PM' ? 12 : 0);
    }
    date = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day || hour > 23 || minute > 59) {
      return text;
    }
  }

  if (!Number.isFinite(date.getTime())) return '';
  const pad = part => String(part).padStart(2, '0');
  return `${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

function formatRxoBusinessHours(dateTime) {
  const date = String(dateTime || '').match(/^(\d{1,2}\/\d{1,2}\/\d{4})\b/)?.[1];
  return date ? `${date} 0800 - 1600` : dateTime;
}

function decodeGmailBody(data) {
  const base64 = String(data || '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function getGmailMessageText(payload) {
  const plainParts = [];
  const htmlParts = [];
  const collectParts = part => {
    if (part.body?.data) {
      if (part.mimeType === 'text/plain') plainParts.push(decodeGmailBody(part.body.data));
      if (part.mimeType === 'text/html') htmlParts.push(decodeGmailBody(part.body.data));
    }
    (part.parts || []).forEach(collectParts);
  };
  collectParts(payload);
  if (plainParts.length) return plainParts.join('\n');
  if (!htmlParts.length) return '';

  const htmlAsText = htmlParts.join('\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:tr|p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, '\n');
  const document = new DOMParser().parseFromString(htmlAsText, 'text/html');
  return (document.body.textContent || '').replace(/[ \t]+\n/g, '\n');
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.oauth2) resolve();
      else reject(new Error('Google authorization did not initialize.'));
    };
    script.onerror = () => reject(new Error('Could not load Google authorization. Check your internet connection.'));
    document.head.appendChild(script);
  });
}

async function getGmailApiError(response, action) {
  let details = '';
  try {
    const body = await response.json();
    const apiError = body.error;
    details = apiError?.message || apiError?.errors?.[0]?.reason || '';
  } catch (error) {
    console.error(`Could not read Gmail ${action} error details:`, error);
  }
  return new Error(`Gmail ${action} failed (${response.status})${details ? `: ${details}` : '.'}`);
}

function parseGmailLoadEmail(messageText, selectedBroker, laneRates) {
  const lines = String(messageText || '')
    .replace(/\r/g, '\n')
    .replace(/\t/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const loads = [];
  let pickupDate = '';
  const parseDate = text => {
    const match = String(text || '').match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
    if (!match) return '';
    const [, month, day, yearText] = match;
    const year = yearText.length === 2 ? `20${yearText}` : yearText;
    return `${month}/${day}/${year}`;
  };
  const findState = text => /^[A-Z]{2,3}$/i.test(text);
  const skipMetadata = text => /^(?:OPEN|INIT|WEB|COST|VIEW|UNBOOKED|HAZMAT)$/i.test(text);
  const createLoad = (id, origin, originState, destination, destinationState, weightText, trailingText = '') => {
    const weight = weightText.match(/[\d,]+(?:\.\d+)?/)?.[0] || '';
    if (!pickupDate || !origin || !destination || !weight) return;
    const tailParts = trailingText.match(/[\d,]+(?:\.\d+)?/g) || [];
    const miles = isCh593772Customer(selectedBroker)
      ? ''
      : tailParts.length ? tailParts[0].replace(/,/g, '') : '';
    const eCode = /\bHAZMAT\b/i.test(messageText.slice(0, 500)) ? 'VZ' : 'VAN:VAN';
    const order = {
      id,
      postingCode: 'ANQ',
      visibilityGroup: 'ANQ',
      eCode,
      status: 'OPEN',
      tag: 'OPEN',
      route: `${origin.toUpperCase()}, ${originState.toUpperCase()} → ${destination.toUpperCase()}, ${destinationState.toUpperCase()}`,
      puDate: `PU: ${pickupDate}`,
      delDate: 'DFL: Upcoming',
      pickupTime: `${pickupDate} 0800 - 1600`,
      deliveryTime: '',
      origCity: origin.toUpperCase(),
      origSt: originState.toUpperCase(),
      origZip: '',
      weight: `${weight} lbs`,
      destCity: destination.toUpperCase(),
      destSt: destinationState.toUpperCase(),
      destZip: '',
      miles,
      planningComment: 'Imported from Gmail',
      carrier: '',
      driver: '',
      truck: '',
      trailer: '',
      rateInput: '',
      brokerable: 'false',
      notes: 'Delivery date/time not included in email; please enter before export.'
    };
    const laneRateKey = createLaneRateKey(selectedBroker, order);
    const savedLaneRate = laneRateKey ? laneRates[laneRateKey] : '';
    if (savedLaneRate) {
      order.rateInput = savedLaneRate;
      order.rateSource = 'user-entered';
    }
    loads.push(order);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const dateHeading = lines[index].match(/\b(\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4}))\s*-\s*[A-Za-z]{3,9}\b/);
    if (dateHeading) pickupDate = parseDate(dateHeading[1]);

    const inlineRow = lines[index].match(
      /^(\d{8,10})\s+(.+?)\s+([A-Z]{2,3})\s+(.+?)\s+([A-Z]{2,3})\s+([\d,]+(?:\.\d+)?)\s*lbs?\b(.*)$/i
    );
    if (inlineRow) {
      createLoad(inlineRow[1], inlineRow[2], inlineRow[3], inlineRow[4], inlineRow[5], inlineRow[6], inlineRow[7]);
      continue;
    }
    if (!/^\d{8,10}$/.test(lines[index])) continue;

    const values = [];
    let nextIndex = index + 1;
    while (nextIndex < lines.length && values.length < 8) {
      if (/^\d{8,10}$/.test(lines[nextIndex])
        || /\b\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4})\s*-\s*[A-Za-z]{3,9}\b/.test(lines[nextIndex])) break;
      if (!skipMetadata(lines[nextIndex])) values.push(lines[nextIndex]);
      nextIndex += 1;
    }

    const originStateIndex = values.findIndex(findState);
    if (originStateIndex < 1) continue;
    const destinationStateIndex = values.findIndex(
      (value, valueIndex) => valueIndex >= originStateIndex + 2 && findState(value)
    );
    if (destinationStateIndex < originStateIndex + 2) continue;
    const weightIndex = values.findIndex((value, valueIndex) =>
      valueIndex > destinationStateIndex && /[\d,]+(?:\.\d+)?\s*lbs?/i.test(value)
    );
    if (weightIndex < 0) continue;
    createLoad(
      lines[index],
      values.slice(0, originStateIndex).join(' '),
      values[originStateIndex],
      values.slice(originStateIndex + 1, destinationStateIndex).join(' '),
      values[destinationStateIndex],
      values[weightIndex],
      values.slice(weightIndex + 1).join(' ')
    );
    index = nextIndex - 1;
  }
  return loads;
}

function toExcelDateTime(value, fallbackDateValue = '') {
  const dateTime = String(value || '').replace(/[•·]/g, ' ').replace(/\s+/g, ' ').trim();
  const fullMatch = dateTime.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,4})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (fullMatch) {
    const [, monthText, dayText, yearText, hourText, minuteText, meridiem] = fullMatch;
    const month = Number(monthText);
    const day = Number(dayText);
    const year = Number(yearText);
    let hour;
    let minute;
    if (minuteText !== undefined) {
      hour = Number(hourText);
      minute = Number(minuteText);
    } else if (hourText.length > 2) {
      hour = Number(hourText.slice(0, -2));
      minute = Number(hourText.slice(-2));
    } else {
      hour = Number(hourText);
      minute = 0;
    }
    if (meridiem) {
      if (hour < 1 || hour > 12) return null;
      hour = hour % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
    }
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day || hour > 23 || minute > 59) return null;
    return (date.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
  }

  const timeMatch = dateTime.match(/^(\d{1,4})(?::(\d{2}))?\s*(AM|PM)?$/i);
  const fallbackMatch = String(fallbackDateValue || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (!timeMatch || !fallbackMatch) return null;
  const [, timeText, minuteText, meridiem] = timeMatch;
  let hour;
  let minute;
  if (minuteText !== undefined) {
    hour = Number(timeText);
    minute = Number(minuteText);
  } else if (timeText.length > 2) {
    hour = Number(timeText.slice(0, -2));
    minute = Number(timeText.slice(-2));
  } else {
    hour = Number(timeText);
    minute = 0;
  }
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  const [, monthText, dayText, yearText] = fallbackMatch;
  const month = Number(monthText);
  const day = Number(dayText);
  const year = Number(yearText);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return (date.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
}

function getLandstarEquipmentCode(value) {
  const code = String(value || '').trim().toUpperCase();
  const equipmentCodes = {
    VZ: 'VAN',
    VAN: 'VAN',
    V: 'VAN',
    VT: 'VAN',
    VE: 'VAN',
    VR: 'VAN',
    R: 'REFR',
    RZ: 'REFR',
    F: 'FLAT',
    SD: 'STEP'
  };
  if (equipmentCodes[code]) return equipmentCodes[code];
  if (code.includes('53 FEET') || code.includes('53FT') || code.includes('53 FT')) return '53VN';
  if (code.startsWith('VAN')) return 'VAN';
  if (code.startsWith('REFR') || code.startsWith('REEFER')) return 'REFR';
  if (code.startsWith('FLAT')) return 'FLAT';
  if (code.startsWith('STEP')) return 'STEP';
  return code.match(/\b(24VN|28VN|48VN|53VN|VAN|REFR|FLAT|48FL|53FL|STEP|53SD|SD)\b/)?.[0] || '';
}

function getLandstarCommodity(value) {
  const equipmentCode = String(value || '').trim().toUpperCase().split(':')[0];
  if (equipmentCode === 'VZ' || equipmentCode === 'RZ') {
    return 'HAZMAT';
  }
  if (equipmentCode === 'VE') {
    return 'CHEM';
  }
  return 'CGAPP';
}

function getLandstarCommodityValue(code) {
  const commodityValues = {
    CGAPP: 'CGAPP-CONSUMER GOODS OR APPLIANCES',
    HAZMAT: 'HAZMAT-HAZMAT NON-HIGH RISK OR AA&E BRP',
    CHEM: 'CHEM-CHEMICALS (NON-HAZ/REGULATED)'
  };
  return commodityValues[code] || '';
}

function getLandstarCity(value, location) {
  const city = String(value || '').trim();
  const postalCity = String(location?.city || '').trim();
  const normalize = name => name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return postalCity && normalize(city) === normalize(postalCity) ? postalCity : city;
}

const rxoCustomerName = 'R X O 2429200 - ATZ';
const rxoPayerCustomerName = 'R X O 2429200 - ATZ P';

function normalizeCustomerName(name) {
  const normalized = String(name || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized === 'RXO2429200ATZP') {
    return rxoPayerCustomerName;
  }
  if (normalized === 'RXO' || normalized === 'RXL' || normalized === 'RXO2429200ATZ') {
    return rxoCustomerName;
  }
  return String(name || '').trim();
}

function isRxoCustomer(name) {
  const normalized = normalizeCustomerName(name);
  return normalized === rxoCustomerName || normalized === rxoPayerCustomerName;
}

function isCh593772Customer(name) {
  return normalizeCustomerName(name).toUpperCase().replace(/[^A-Z0-9]/g, '') === 'CH593772ATZ';
}

async function getGoogleRoadMiles(order) {
  const response = await fetch('/api/road-miles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      origin: { city: order.origCity, state: order.origSt, zip: order.origZip },
      destination: { city: order.destCity, state: order.destSt, zip: order.destZip }
    })
  });
  let result;
  try {
    result = await response.json();
  } catch (error) {
    console.error('Could not read Google Routes road-mile response:', error);
    throw new Error(`Google Routes returned an invalid response for load ${order.id}.`);
  }
  if (!response.ok || !Number.isFinite(result?.miles) || result.miles <= 0) {
    throw new Error(`Could not calculate driving miles for load ${order.id}: ${result?.error || 'Google Routes returned no valid mileage.'}`);
  }
  return String(result.miles);
}

function normalizeLoadId(value) {
  const text = String(value || '').trim();
  const digits = text.replace(/\D/g, '');
  return digits || text.toUpperCase();
}

function getExportedRecordsForCustomer(registry, customer) {
  const customerKey = normalizeCustomerName(customer).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const matchingEntries = Object.entries(registry || {}).filter(([key]) =>
    normalizeCustomerName(key).toUpperCase().replace(/[^A-Z0-9]/g, '') === customerKey
  );
  return matchingEntries.reduce((records, [, value]) => ({
    ids: [...records.ids, ...(Array.isArray(value?.ids) ? value.ids : []).map(normalizeLoadId)],
    laneDays: [...records.laneDays, ...(Array.isArray(value?.laneDays) ? value.laneDays : [])]
  }), { ids: [], laneDays: [] });
}

function createLaneDayKey(order) {
  const normalize = value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const origin = normalize(order.origCity);
  const destination = normalize(order.destCity);
  const originState = normalize(order.origSt);
  const destinationState = normalize(order.destSt);
  const dateText = String(order.pickupTime || order.puDate || '');
  const usDate = dateText.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  const isoDate = dateText.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (!origin || !destination || !usDate && !isoDate) return '';

  const pickupDate = usDate
    ? `${usDate[3].length === 2 ? `20${usDate[3]}` : usDate[3]}-${usDate[1].padStart(2, '0')}-${usDate[2].padStart(2, '0')}`
    : `${isoDate[1]}-${isoDate[2].padStart(2, '0')}-${isoDate[3].padStart(2, '0')}`;
  return JSON.stringify([origin, originState, destination, destinationState, pickupDate]);
}

function removeDuplicateLaneDayLoads(loads) {
  const seenLaneDays = new Set();
  let duplicateCount = 0;
  const uniqueLoads = loads.filter(load => {
    const key = createLaneDayKey(load);
    if (!key) return true;
    if (seenLaneDays.has(key)) {
      duplicateCount += 1;
      return false;
    }
    seenLaneDays.add(key);
    return true;
  });
  return { loads: uniqueLoads, duplicateCount };
}

function createLaneRateKey(customer, order) {
  const normalize = value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const origin = normalize(order.origCity);
  const destination = normalize(order.destCity);
  if (!origin || !destination) return '';
  return JSON.stringify([
    normalizeCustomerName(customer),
    origin,
    normalize(order.origSt),
    normalize(order.origZip),
    destination,
    normalize(order.destSt),
    normalize(order.destZip),
    normalize(order.eCode)
  ]);
}

function normalizeBrokerList(value) {
  const brokerList = Array.isArray(value) ? value : ['Para 1522166 - ATZ', rxoCustomerName];
  const normalizedBrokers = Array.from(new Set(brokerList.map(normalizeCustomerName).filter(Boolean)));
  if (normalizedBrokers.some(isRxoCustomer)) {
    [rxoCustomerName, rxoPayerCustomerName].forEach(name => {
      if (!normalizedBrokers.includes(name)) normalizedBrokers.push(name);
    });
  }
  return normalizedBrokers;
}

function normalizeCustomerOrders(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : defaultCustomerDatasets;
  const normalized = {};
  Object.entries(source).forEach(([name, loads]) => {
    const normalizedName = normalizeCustomerName(name);
    if (!Array.isArray(loads)) return;
    const merged = new Map((normalized[normalizedName] || []).map(load => [load.id, load]));
    loads.forEach(load => {
      if (!load || load.id == null) return;
      const normalizedLoad = { postingCode: 'ANQ', brokerable: 'false', ...load, visibilityGroup: 'ANQ' };
      merged.set(load.id, normalizedLoad);
    });
    normalized[normalizedName] = Array.from(merged.values());
  });
  return normalized;
}

const defaultCustomerDatasets = {
  'Para 1522166 - ATZ': [
    { id: '2274611', visibilityGroup: 'ANQ', eCode: 'VZ', status: 'ENT', tag: 'ENT', route: 'NORFOLK, VA → CHARLOTTE, NC', puDate: 'PU: 10/15 0500', delDate: 'DFL: 10/16 0900', pickupTime: '10/15/2026 0500 - 1500', origCity: 'NORFOLK', origSt: 'VA', origZip: '23502', weight: '42,852 lbs', deliveryTime: '10/16/2026 0000 - 1500', destCity: 'CHARLOTTE', destSt: 'NC', destZip: '29217', miles: '327', planningComment: 'Standard Dry Van Load', carrier: '', driver: '', truck: '', trailer: '', rateInput: '', brokerable: 'false', notes: '' }
  ],
  [rxoCustomerName]: [
    { id: '24424438', visibilityGroup: 'RXO', eCode: 'VAN:VAN', status: 'OPEN', tag: 'OPEN', route: 'BOLINGBROOK, IL → SCOTTSVILLE, KY', puDate: 'PU: Today', delDate: 'DFL: Upcoming', pickupTime: '10/18/2026 0800 - 1200', origCity: 'BOLINGBROOK', origSt: 'IL', origZip: '60440', weight: '20000 lbs', deliveryTime: '10/20/2026 0800 - 1700', destCity: 'SCOTTSVILLE', destSt: 'KY', destZip: '42164', miles: '431', planningComment: 'Imported from Excel', carrier: '', driver: '', truck: '', trailer: '', rateInput: '', brokerable: 'false', notes: '' }
  ]
};

export default function App() {
  const [brokers, setBrokers] = useState(() => {
    try {
      return normalizeBrokerList(JSON.parse(localStorage.getItem('landstar_brokers')));
    } catch (error) {
      console.error('Could not load saved customer names:', error);
      return normalizeBrokerList(null);
    }
  });
  
  const [selectedBroker, setSelectedBroker] = useState(() => {
    try {
      const savedBrokers = JSON.parse(localStorage.getItem('landstar_brokers'));
      return normalizeBrokerList(savedBrokers)[0] || 'Para 1522166 - ATZ';
    } catch (error) {
      console.error('Could not load the selected customer:', error);
      return 'Para 1522166 - ATZ';
    }
  });
  
  const [customerOrdersMap, setCustomerOrdersMap] = useState(() => {
    try {
      return removeExpiredExportedLoads(
        normalizeCustomerOrders(JSON.parse(localStorage.getItem('landstar_customerOrdersMap')))
      );
    } catch (error) {
      console.error('Could not load saved customer loads:', error);
      return defaultCustomerDatasets;
    }
  });
  const [laneRates, setLaneRates] = useState(() => {
    try {
      const savedRates = JSON.parse(localStorage.getItem('landstar_laneRates'));
      return savedRates && typeof savedRates === 'object' && !Array.isArray(savedRates) ? savedRates : {};
    } catch (error) {
      console.error('Could not load saved lane rates:', error);
      return {};
    }
  });
  const [exportedLoadRegistry, setExportedLoadRegistry] = useState(() => {
    try {
      const savedRegistry = JSON.parse(localStorage.getItem('landstar_exportedLoads'));
      return savedRegistry && typeof savedRegistry === 'object' && !Array.isArray(savedRegistry)
        ? savedRegistry
        : {};
    } catch (error) {
      console.error('Could not load previously exported load records:', error);
      return {};
    }
  });
  
  const orders = customerOrdersMap[selectedBroker] || [];
  const [selectedOrder, setSelectedOrder] = useState(() => orders[0] || null);

  const [filter, setFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [loadFilters, setLoadFilters] = useState({ minMiles: '', maxMiles: '' });
  const [laneSort, setLaneSort] = useState('');
 
  const [isAddingBroker, setIsAddingBroker] = useState(false);
  const [newBrokerInput, setNewBrokerInput] = useState('');
 
  const [editingBroker, setEditingBroker] = useState(null);
  const [editBrokerInput, setEditBrokerInput] = useState('');

  const [selectedIds, setSelectedIds] = useState([]);
  const [exportErrorIds, setExportErrorIds] = useState([]);
  const [isImportingScreenshot, setIsImportingScreenshot] = useState(false);
  const [screenshotImportMode, setScreenshotImportMode] = useState('');
  const [screenshotImportProgress, setScreenshotImportProgress] = useState('');
  const [isGmailImportOpen, setIsGmailImportOpen] = useState(false);
  const [gmailClientId, setGmailClientId] = useState(() => {
    try {
      return localStorage.getItem('landstar_gmailClientId') || '';
    } catch (error) {
      console.error('Could not load the saved Google client ID:', error);
      return '';
    }
  });
  const [gmailQuery, setGmailQuery] = useState('');
  const [gmailAuthReady, setGmailAuthReady] = useState(false);
  const [gmailImportProgress, setGmailImportProgress] = useState('');
  const [storageError, setStorageError] = useState('');

  const getLatestExportedRegistry = () => {
    try {
      const storedRegistry = JSON.parse(localStorage.getItem('landstar_exportedLoads'));
      return storedRegistry && typeof storedRegistry === 'object' && !Array.isArray(storedRegistry)
        ? storedRegistry
        : exportedLoadRegistry;
    } catch (error) {
      console.error('Could not read the latest exported-load history:', error);
      return exportedLoadRegistry;
    }
  };

  const persistAppData = (nextBrokers = brokers, nextOrders = customerOrdersMap) => {
    try {
      localStorage.setItem('landstar_brokers', JSON.stringify(nextBrokers));
      localStorage.setItem('landstar_customerOrdersMap', JSON.stringify(nextOrders));
      setStorageError('');
      return true;
    } catch (error) {
      console.error('Could not save customer loads in this browser:', error);
      setStorageError('Could not save changes in this browser. Keep this page open and check available storage.');
      return false;
    }
  };

  useEffect(() => {
    persistAppData();
  }, [brokers, customerOrdersMap]);

  useEffect(() => {
    const cleanupExpiredLoads = () => {
      setCustomerOrdersMap(current => removeExpiredExportedLoads(current));
    };
    const interval = window.setInterval(cleanupExpiredLoads, 60 * 60 * 1000);
    window.addEventListener('focus', cleanupExpiredLoads);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', cleanupExpiredLoads);
    };
  }, []);

  useEffect(() => {
    if (!isGmailImportOpen) return undefined;
    let active = true;
    setGmailAuthReady(false);
    setGmailImportProgress('Loading Google authorization...');
    loadGoogleIdentityScript()
      .then(() => {
        if (active) {
          setGmailAuthReady(true);
          setGmailImportProgress('');
        }
      })
      .catch(error => {
        console.error('Could not initialize Google authorization:', error);
        if (active) setGmailImportProgress(error.message);
      });
    return () => {
      active = false;
    };
  }, [isGmailImportOpen]);

  useEffect(() => {
    if (orders.length > 0) {
      if (!selectedOrder || !orders.some(o => o.id === selectedOrder.id)) {
        setSelectedOrder(orders[0]);
      }
    } else {
      setSelectedOrder(null);
    }
  }, [selectedBroker, customerOrdersMap]);

  const handleSelectBroker = (brokerName) => {
    setSelectedBroker(brokerName);
    const brokerLoads = customerOrdersMap[brokerName] || [];
    if (brokerLoads.length > 0) {
      setSelectedOrder(brokerLoads[0]);
    } else {
      setSelectedOrder(null);
    }
    setSelectedIds([]);
  };

  const handleInputChange = (field, value) => {
    if (!selectedOrder) return;
    let updatedOrder = { ...selectedOrder, [field]: value };
    if (field === 'rateInput') {
      if (String(value).trim()) {
        updatedOrder.rateSource = 'user-entered';
      } else {
        delete updatedOrder.rateSource;
      }
      const laneRateKey = createLaneRateKey(selectedBroker, updatedOrder);
      const numericRate = Number(String(value).replace(/[$,]/g, ''));
      if (laneRateKey && numericRate > 0 && Number.isFinite(numericRate)) {
        const nextLaneRates = { ...laneRates, [laneRateKey]: String(value).trim() };
        setLaneRates(nextLaneRates);
        try {
          localStorage.setItem('landstar_laneRates', JSON.stringify(nextLaneRates));
        } catch (error) {
          console.error('Could not save lane rate:', error);
          setStorageError('Could not save lane rates in this browser. Check available storage.');
        }
      }
      if (numericRate > 0 && Number.isFinite(numericRate)) {
        setSelectedIds(previousIds => (
          previousIds.includes(updatedOrder.id) ? previousIds : [...previousIds, updatedOrder.id]
        ));
      }
    } else if (['origCity', 'origSt', 'origZip', 'destCity', 'destSt', 'destZip', 'eCode'].includes(field)) {
      const laneRateKey = createLaneRateKey(selectedBroker, updatedOrder);
      const savedRate = laneRateKey ? laneRates[laneRateKey] : '';
      if (savedRate) {
        updatedOrder.rateInput = savedRate;
        updatedOrder.rateSource = 'user-entered';
      } else {
        updatedOrder.rateInput = '';
        delete updatedOrder.rateSource;
      }
    }
    
    setSelectedOrder(updatedOrder);
    setCustomerOrdersMap(prev => ({
      ...prev,
      [selectedBroker]: (prev[selectedBroker] || []).map(o => o.id === updatedOrder.id ? updatedOrder : o)
    }));
  };

  const handleOpenDatRateView = async () => {
    if (!selectedOrder) return;
    const origin = [selectedOrder.origCity, selectedOrder.origSt, selectedOrder.origZip].filter(Boolean).join(', ');
    const destination = [selectedOrder.destCity, selectedOrder.destSt, selectedOrder.destZip].filter(Boolean).join(', ');
    const equipment = getEquipmentDescription(selectedOrder.eCode) || selectedOrder.eCode || 'Not specified';
    const laneDetails = [
      `Customer: ${selectedBroker}`,
      `Origin: ${origin || 'Not specified'}`,
      `Destination: ${destination || 'Not specified'}`,
      `Equipment: ${equipment}`,
      `Pickup: ${selectedOrder.pickupTime || selectedOrder.puDate || 'Not specified'}`,
      `Weight: ${selectedOrder.weight || 'Not specified'}`,
      `Order #: ${selectedOrder.id || 'Not specified'}`
    ].join('\n');

    window.open('https://iq.dat.com/rateview', '_blank', 'noopener,noreferrer');

    try {
      await navigator.clipboard.writeText(laneDetails);
    } catch (error) {
      console.error('Could not copy the RateView lane details to the clipboard:', error);
    }
  };

  const handleOpenLandstarLoads = async () => {
    if (!selectedOrder) return;
    window.open('https://www.landstaronline.com/loads/', '_blank', 'noopener,noreferrer');

    const laneDetails = [
      `Origin: ${[selectedOrder.origCity, selectedOrder.origSt, selectedOrder.origZip].filter(Boolean).join(', ')}`,
      `Destination: ${[selectedOrder.destCity, selectedOrder.destSt, selectedOrder.destZip].filter(Boolean).join(', ')}`
    ].join('\n');

    try {
      await navigator.clipboard.writeText(laneDetails);
      alert('Landstar Loads opened. Origin and destination details are copied; paste them into the matching fields.');
    } catch (error) {
      console.error('Could not copy the Landstar origin and destination details:', error);
      alert('Landstar Loads opened, but the lane details could not be copied. Check clipboard permissions and try again.');
    }
  };

  const handleSave = () => {
    if (!selectedOrder) return;
    alert(`Order #${selectedOrder.id} saved and secured successfully for ${selectedBroker}!`);
  };

  const handleDelete = () => {
    if (!selectedOrder) return;
    const remaining = orders.filter(o => o.id !== selectedOrder.id);
    setCustomerOrdersMap(prev => ({ ...prev, [selectedBroker]: remaining }));
    if (remaining.length > 0) setSelectedOrder(remaining[0]);
    else setSelectedOrder(null);
  };

  const handleToggleSelect = (id, e) => {
    e.stopPropagation();
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(item => item !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleSelectAll = (filteredOrders) => {
    const filteredIds = filteredOrders.map(o => o.id);
    const allSelected = filteredIds.every(id => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds(selectedIds.filter(id => !filteredIds.includes(id)));
    } else {
      const combined = Array.from(new Set([...selectedIds, ...filteredIds]));
      setSelectedIds(combined);
    }
  };

  const handleSelectFirst25 = () => {
    const first25Ids = filteredOrders.slice(0, 25).map(o => o.id);
    setSelectedIds(first25Ids);
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    if (window.confirm(`Are you sure you want to delete ${selectedIds.length} selected loads?`)) {
      const remaining = orders.filter(o => !selectedIds.includes(o.id));
      setCustomerOrdersMap(prev => ({ ...prev, [selectedBroker]: remaining }));
      setSelectedIds([]);
      if (remaining.length > 0) setSelectedOrder(remaining[0]);
      else setSelectedOrder(null);
    }
  };

  const handleStatusChange = (newStatus) => {
    if (!selectedOrder) return;
    const updatedOrder = {
      ...selectedOrder,
      status: newStatus,
      tag: newStatus === 'ENT' ? 'ENT' : newStatus === 'ON HOLD' ? 'HOLD' : 'OPEN'
    };
    setSelectedOrder(updatedOrder);
    setCustomerOrdersMap(prev => ({
      ...prev,
      [selectedBroker]: prev[selectedBroker].map(o => o.id === updatedOrder.id ? updatedOrder : o)
    }));
  };

  const copyToClipboard = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error(`Could not copy ${label} to the clipboard:`, error);
    }
  };

  const renderCopyableField = (label, field) => (
    <div className="min-w-0">
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      <div className="flex gap-1">
        <input
          type="text"
          value={selectedOrder[field] || ''}
          onChange={(e) => handleInputChange(field, e.target.value)}
          className="min-w-0 w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white"
        />
        <button
          type="button"
          onClick={() => copyToClipboard(selectedOrder[field] || '', label)}
          aria-label={`Copy ${label}`}
          title={`Copy ${label}`}
          className="shrink-0 bg-slate-700 hover:bg-slate-600 text-white px-2 rounded text-[11px] cursor-pointer"
        >
          📋
        </button>
      </div>
    </div>
  );

  const handleAddBroker = (e) => {
    e.preventDefault();
    const name = normalizeCustomerName(newBrokerInput);
    if (name && !brokers.includes(name)) {
      const updatedBrokers = [...brokers, name];
      setBrokers(updatedBrokers);
      setCustomerOrdersMap(prev => ({ ...prev, [name]: [] }));
      handleSelectBroker(name);
      setNewBrokerInput('');
      setIsAddingBroker(false);
    }
  };

  const handleSaveEditBroker = (oldName, e) => {
    e.preventDefault();
    const newName = normalizeCustomerName(editBrokerInput);
    if (newName && !brokers.includes(newName)) {
      const updatedBrokers = brokers.map(b => b === oldName ? newName : b);
      setBrokers(updatedBrokers);
      
      setCustomerOrdersMap(prev => {
        const copy = { ...prev };
        copy[newName] = copy[oldName];
        delete copy[oldName];
        return copy;
      });

      if (selectedBroker === oldName) {
        setSelectedBroker(newName);
      }
      setEditingBroker(null);
      setEditBrokerInput('');
    }
  };

  const handleDeleteBroker = (brokerToDelete, e) => {
    e.stopPropagation();
    if (brokers.length <= 1) {
      alert("You must keep at least one customer/broker.");
      return;
    }
    if (window.confirm(`Delete customer "${brokerToDelete}"?`)) {
      const updatedBrokers = brokers.filter(b => b !== brokerToDelete);
      setBrokers(updatedBrokers);
      
      setCustomerOrdersMap(prev => {
        const copy = { ...prev };
        delete copy[brokerToDelete];
        return copy;
      });

      if (selectedBroker === brokerToDelete) {
        handleSelectBroker(updatedBrokers[0]);
      }
    }
  };

  const handleGmailImport = async () => {
    if (!gmailAuthReady || !window.google?.accounts?.oauth2) {
      alert(gmailImportProgress || 'Google authorization is still loading. Wait a moment and try again.');
      return;
    }
    if (!gmailClientId.trim()) {
      alert('Enter a Google OAuth Web client ID first. The Gmail setup instructions are shown above the search box.');
      return;
    }
    if (!gmailQuery.trim()) {
      alert('Enter a Gmail search query, such as newer_than:7d or from:loads@example.com.');
      return;
    }

    let accessToken;
    try {
      localStorage.setItem('landstar_gmailClientId', gmailClientId.trim());
      accessToken = await new Promise((resolve, reject) => {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: gmailClientId.trim(),
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
          callback: response => {
            if (response.error || !response.access_token) {
              reject(new Error(response.error_description || response.error || 'Google did not grant Gmail read-only access.'));
              return;
            }
            resolve(response.access_token);
          },
          error_callback: error => reject(new Error(error.message || 'Google authorization was cancelled or blocked.'))
        });
        tokenClient.requestAccessToken({ prompt: 'consent' });
      });

      setGmailImportProgress('Searching Gmail...');
      const apiHeaders = { Authorization: `Bearer ${accessToken}` };
      const searchResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(gmailQuery.trim())}&maxResults=1`,
        { headers: apiHeaders }
      );
      if (!searchResponse.ok) {
        throw await getGmailApiError(searchResponse, 'search');
      }
      const searchResult = await searchResponse.json();
      const messages = searchResult.messages || [];
      if (!messages.length) {
        alert('Gmail search found no matching messages.');
        return;
      }

      const parsedLoads = [];
      for (let index = 0; index < messages.length; index += 1) {
        setGmailImportProgress('Reading newest matching email...');
        const messageResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messages[index].id)}?format=full`,
          { headers: apiHeaders }
        );
        if (!messageResponse.ok) {
          throw await getGmailApiError(messageResponse, `message read for ${messages[index].id}`);
        }
        const message = await messageResponse.json();
        const text = getGmailMessageText(message.payload || {});
        parsedLoads.push(...parseGmailLoadEmail(text, selectedBroker, laneRates));
      }

      if (!parsedLoads.length) {
        alert('The newest matching email was read, but no load rows could be recognized. Check that the email contains load numbers, origin/destination, weight, and pickup-date headings.');
        return;
      }

      const latestRegistry = getLatestExportedRegistry();
      const exportedRecords = getExportedRecordsForCustomer(latestRegistry, selectedBroker);
      const exportedIds = new Set(exportedRecords.ids);
      const exportedLaneDays = new Set(exportedRecords.laneDays || []);
      const notExported = parsedLoads.filter(load => {
        const laneDayKey = createLaneDayKey(load);
        return !exportedIds.has(normalizeLoadId(load.id)) && (!laneDayKey || !exportedLaneDays.has(laneDayKey));
      });
      const { loads: uniqueLoads, duplicateCount } = isRxoCustomer(selectedBroker)
        ? removeDuplicateLaneDayLoads(notExported)
        : { loads: notExported, duplicateCount: 0 };
      if (!uniqueLoads.length) {
        alert(`Found ${parsedLoads.length} loads, but they were all previously exported or duplicated.`);
        return;
      }

      let mileageCalculationError = '';
      if (isCh593772Customer(selectedBroker)) {
        const loadsNeedingMiles = uniqueLoads.filter(load => !(Number(load.miles) > 0));
        for (let index = 0; index < loadsNeedingMiles.length; index += 1) {
          const load = loadsNeedingMiles[index];
          setGmailImportProgress(`Calculating driving miles ${index + 1} of ${loadsNeedingMiles.length}...`);
          try {
            load.miles = await getGoogleRoadMiles(load);
            load.planningComment = 'Imported from Gmail; driving miles calculated by Google Routes';
          } catch (error) {
            console.error('Google Routes could not calculate Gmail load miles:', error);
            mileageCalculationError = error.message || 'Google Routes could not calculate the driving miles.';
            load.planningComment = 'Imported from Gmail; driving miles need to be entered manually';
            for (let remainingIndex = index + 1; remainingIndex < loadsNeedingMiles.length; remainingIndex += 1) {
              loadsNeedingMiles[remainingIndex].planningComment = 'Imported from Gmail; driving miles need to be entered manually';
            }
            break;
          }
        }
      }

      const existingOrders = customerOrdersMap[selectedBroker] || [];
      const merged = new Map(existingOrders.map(load => [String(load.id), load]));
      uniqueLoads.forEach(load => {
        const existingLoad = merged.get(String(load.id));
        merged.set(String(load.id), existingLoad
          ? {
            ...existingLoad,
            ...load,
            miles: load.miles || existingLoad.miles,
            rateInput: existingLoad.rateInput || load.rateInput,
            rateSource: existingLoad.rateSource || load.rateSource
          }
          : load);
      });
      const mergedList = Array.from(merged.values());
      const { loads: finalLoads, duplicateCount: existingDuplicates } = isRxoCustomer(selectedBroker)
        ? removeDuplicateLaneDayLoads(mergedList)
        : { loads: mergedList, duplicateCount: 0 };
      const nextOrders = { ...customerOrdersMap, [selectedBroker]: finalLoads };
      const saved = persistAppData(brokers, nextOrders);
      setCustomerOrdersMap(nextOrders);
      setSelectedOrder(finalLoads.find(load => load.id === uniqueLoads[0].id) || finalLoads[0]);
      setSelectedIds([]);
      alert(`Imported ${uniqueLoads.length} loads from Gmail for ${selectedBroker}.${duplicateCount + existingDuplicates ? ` Removed ${duplicateCount + existingDuplicates} duplicate load${duplicateCount + existingDuplicates === 1 ? '' : 's'}.` : ''}${parsedLoads.length - notExported.length ? ` Skipped ${parsedLoads.length - notExported.length} previously exported load${parsedLoads.length - notExported.length === 1 ? '' : 's'}.` : ''}${saved ? ' Loads are saved in this browser.' : ' Saving failed; keep this page open and check browser storage.'} Delivery dates were not in the email and are left blank for you to fill in.${mileageCalculationError ? ` Driving miles were not calculated and remain blank where no prior miles were saved. You can still access the loads and enter miles manually. Google Routes reported: ${mileageCalculationError}` : ''}`);
    } catch (error) {
      console.error('Gmail load import failed:', error);
      alert(`Gmail import failed: ${error.message || 'Check your Google OAuth client ID, Gmail API setup, and search query.'}`);
    } finally {
      setGmailImportProgress('');
    }
  };

  const handleExcelImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: false });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (rawRows.length <= 1) {
          alert("The uploaded Excel sheet is empty or only contains headers!");
          return;
        }

        const headerRow = rawRows[0] || [];
        const findColIndex = (possibleNames, defaultIdx) => {
          for (let name of possibleNames) {
            const idx = headerRow.findIndex(h => String(h || '').trim().toLowerCase() === name.toLowerCase());
            if (idx !== -1) return idx;
          }
          return defaultIdx;
        };

        const colA = findColIndex(['Order #', 'Load ID', 'Order Number', 'Load Posting Code'], 0);
        const colB = findColIndex(['Equipment', 'Equipment 1', 'Equip'], 1);
        const colG = findColIndex(['Origin City', 'Orig City', 'Origin'], 6);
        const colH = findColIndex(['Origin State', 'Origin St', 'Orig State'], 7);
        const colI = findColIndex(['Origin Zipcode', 'Origin Zip', 'Orig Zip'], 8);
        const colL = findColIndex(['Destination City', 'Dest City', 'Destination'], 11);
        const colM = findColIndex(['Destination State', 'Destination St', 'Dest State'], 12);
        const colN = findColIndex(['Destination Zipcode', 'Destination Zip', 'Dest Zip'], 13);
        const colO = findColIndex(['Weight', 'Wgt', 'Weight (lbs)'], 14);
        const isRxoImport = isRxoCustomer(selectedBroker);
        const hasRxoTimeColumns = headerRow.some(
          header => String(header || '').trim().toLowerCase() === 'pickup time'
        ) && headerRow.some(
          header => String(header || '').trim().toLowerCase() === 'delivery time'
        );
        const useRxoDateTimeFormat = isRxoImport || hasRxoTimeColumns;
        const colQ = isRxoImport ? 16 : findColIndex(['Pickup Date (From)', 'Pickup Time', 'PU Time'], 16);
        const colR = isRxoImport ? 17 : findColIndex(['Delivery Date (From)', 'Delivery Time', 'Del Time'], 17);
        const colS = findColIndex(['Bill as Miles', 'Miles', 'Distance'], 18);

        const dataRows = rawRows.slice(1);
        const getRxoDateTime = (row, rowIndex, colIndex) => {
          const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex + 1, c: colIndex })];
          return formatRxoExcelDateTime(cell ? XLSX.utils.format_cell(cell) : row[colIndex]);
        };

        const importedRows = dataRows.map((row, idx) => {
          if (!row || row.length === 0) return null;

          const loadId = String(row[colA] || `IMP-${Date.now()}-${idx}`).trim();
          const origC = String(row[colG] || 'UNKNOWN').toUpperCase().trim();
          const origS = String(row[colH] || '').toUpperCase().trim();
          const origZ = String(row[colI] || '00000').trim();
          const destC = String(row[colL] || 'UNKNOWN').toUpperCase().trim();
          const destS = String(row[colM] || '').toUpperCase().trim();
          const destZ = String(row[colN] || '00000').trim();
          const weightVal = String(row[colO] || '40000 lbs').trim();
          
          const puTimeVal = useRxoDateTimeFormat
            ? getRxoDateTime(row, idx, colQ)
            : formatExcelDateTime(row[colQ]);
          const delTimeVal = useRxoDateTimeFormat
            ? getRxoDateTime(row, idx, colR)
            : formatExcelDateTime(row[colR]);
          const milesVal = String(row[colS] || '500').trim();

          const laneKey = `${origC}${origS ? ', ' + origS : ''} → ${destC}${destS ? ', ' + destS : ''}`;
          
          const rawEquip = row[colB];
          const eCodeVal = isRxoCustomer(selectedBroker) ? 'VAN:VAN' : String(rawEquip || 'VZ').toUpperCase().trim();
          const laneRateKey = createLaneRateKey(selectedBroker, {
            origCity: origC,
            origSt: origS,
            origZip: origZ,
            destCity: destC,
            destSt: destS,
            destZip: destZ,
            eCode: eCodeVal
          });
          const savedLaneRate = laneRateKey ? laneRates[laneRateKey] : '';

          return {
            id: loadId,
            postingCode: 'ANQ',
            visibilityGroup: 'ANQ',
            eCode: eCodeVal,
            status: 'OPEN',
            tag: 'OPEN',
            route: laneKey,
            puDate: useRxoDateTimeFormat && puTimeVal ? `PU: ${puTimeVal.split(' ')[0]}` : 'PU: Today',
            delDate: useRxoDateTimeFormat && delTimeVal ? `DFL: ${delTimeVal.split(' ')[0]}` : 'DFL: Upcoming',
            pickupTime: isRxoImport ? formatRxoBusinessHours(puTimeVal) : puTimeVal,
            origCity: origC,
            origSt: origS,
            origZip: origZ,
            weight: weightVal,
            deliveryTime: isRxoImport ? formatRxoBusinessHours(delTimeVal) : delTimeVal,
            destCity: destC,
            destSt: destS,
            destZip: destZ,
            miles: milesVal,
            planningComment: 'Imported from Excel',
            carrier: '',
            driver: '',
            truck: '',
            trailer: '',
            rateInput: savedLaneRate,
            ...(savedLaneRate ? { rateSource: 'user-entered' } : {}),
            brokerable: 'false',
            notes: ''
          };
        }).filter(Boolean);
        const latestRegistry = getLatestExportedRegistry();
        const exportedRecords = getExportedRecordsForCustomer(latestRegistry, selectedBroker);
        const exportedIds = new Set(exportedRecords.ids);
        const exportedLaneDays = new Set(exportedRecords.laneDays || []);
        const notPreviouslyExportedRows = importedRows.filter(load => {
          const laneDayKey = createLaneDayKey(load);
          return !exportedIds.has(normalizeLoadId(load.id)) && (!laneDayKey || !exportedLaneDays.has(laneDayKey));
        });
        const skippedExportedCount = importedRows.length - notPreviouslyExportedRows.length;
        const { loads: importedLoads, duplicateCount: duplicateImportCount } = isRxoImport
          ? removeDuplicateLaneDayLoads(notPreviouslyExportedRows)
          : { loads: notPreviouslyExportedRows, duplicateCount: 0 };

        if (importedLoads.length === 0) {
          alert(skippedExportedCount
            ? `All ${skippedExportedCount} loads in this spreadsheet were already exported for ${selectedBroker}, so none were added again.`
            : "No valid loads found in the spreadsheet rows.");
          return;
        }

        const existingLoads = customerOrdersMap[selectedBroker] || [];
        const mergedLoads = new Map(existingLoads.map(load => [load.id, load]));
        importedLoads.forEach(load => {
          const existingLoad = mergedLoads.get(load.id);
          if (!existingLoad) {
            mergedLoads.set(load.id, load);
          } else if (useRxoDateTimeFormat) {
            mergedLoads.set(load.id, {
              ...existingLoad,
              pickupTime: load.pickupTime || existingLoad.pickupTime,
              deliveryTime: load.deliveryTime || existingLoad.deliveryTime,
              rateInput: existingLoad.rateInput || load.rateInput,
              rateSource: existingLoad.rateSource || load.rateSource,
              puDate: load.puDate,
              delDate: load.delDate
            });
          }
        });
        const mergedLoadList = Array.from(mergedLoads.values());
        const { loads: finalLoads, duplicateCount: duplicateExistingCount } = isRxoImport
          ? removeDuplicateLaneDayLoads(mergedLoadList)
          : { loads: mergedLoadList, duplicateCount: 0 };
        const nextOrders = { ...customerOrdersMap, [selectedBroker]: finalLoads };
        const saved = persistAppData(brokers, nextOrders);
        setCustomerOrdersMap(nextOrders);
        setSelectedOrder(finalLoads.find(load => load.id === importedLoads[0].id) || finalLoads[0]);
        setSelectedIds([]);
        const duplicatesRemoved = duplicateImportCount + duplicateExistingCount;
        alert(`Successfully imported ${importedLoads.length} unique loads for ${selectedBroker}.${skippedExportedCount ? ` Skipped ${skippedExportedCount} load${skippedExportedCount === 1 ? '' : 's'} already exported.` : ''}${duplicatesRemoved ? ` Removed ${duplicatesRemoved} duplicate load${duplicatesRemoved === 1 ? '' : 's'} with the same lane and pickup date.` : ''}${saved ? ' They are saved in this browser.' : ' Saving failed; keep this page open and check browser storage.'}`);
      } catch (err) {
        console.error(err);
        alert("Error parsing Excel file. Please make sure it's a valid .xlsx or .xls file.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleScreenshotImport = async (event, importMode = 'ai') => {
    const file = event.target.files[0];
    if (!file) return;
    const brokerName = selectedBroker;
    let worker;
    let imageUrl;

    setScreenshotImportMode(importMode);
    setIsImportingScreenshot(true);
    setScreenshotImportProgress(importMode === 'dat' ? 'Preparing DAT screenshot...' : importMode === 'ntg' ? 'Preparing NTG screenshot...' : 'Preparing customer screenshot...');
    try {
      if (!file.type.startsWith('image/')) {
        throw new Error('Please choose an image file.');
      }

      setScreenshotImportProgress('Loading OCR module...');
      const tesseractModule = await import('tesseract.js');
      const createWorker = tesseractModule.createWorker || tesseractModule.default?.createWorker;
      if (typeof createWorker !== 'function') {
        throw new Error('The OCR engine could not be loaded.');
      }
      setScreenshotImportProgress('Opening screenshot...');
      const image = new Image();
      imageUrl = URL.createObjectURL(file);
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('The selected image could not be opened.'));
        image.src = imageUrl;
      });
      setScreenshotImportProgress('Loading OCR engine...');

      const scale = Math.min(3, 5000 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not prepare the image for text recognition.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      worker = await createWorker('eng', 1, {
        logger: message => {
          if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
            setScreenshotImportProgress(`Recognizing ${Math.round(message.progress * 100)}%`);
          } else if (message.status) {
            setScreenshotImportProgress(message.status);
          }
        }
      });
      setScreenshotImportProgress('Recognizing text...');
      await worker.setParameters({
        tessedit_pageseg_mode: importMode === 'dat' || importMode === 'ntg' ? '3' : '6'
      });
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      const lines = (data.blocks || []).flatMap(block =>
        block.paragraphs.flatMap(paragraph => paragraph.lines)
      );
      const dataLines = lines
        .filter(line => line.bbox.y0 >= canvas.height * 0.035)
        .sort((a, b) => a.bbox.y0 - b.bbox.y0);
      const centers = dataLines.map(line => (line.bbox.y0 + line.bbox.y1) / 2);
      const spacings = centers.slice(1)
        .map((center, index) => center - centers[index])
        .filter(spacing => spacing > 0 && spacing < canvas.height * 0.08)
        .sort((a, b) => a - b);
      const rowSpacing = spacings[Math.floor(spacings.length / 2)];

      if (rowSpacing && importMode !== 'ntg') {
        for (let index = 1; index < dataLines.length; index += 1) {
          const previousCenter = centers[index - 1];
          const nextCenter = centers[index];
          const missingCount = Math.max(0, Math.round((nextCenter - previousCenter) / rowSpacing) - 1);

          for (let missingIndex = 0; missingIndex < missingCount; missingIndex += 1) {
            const expectedCenter = previousCenter + rowSpacing * (missingIndex + 1);
            const cropTop = Math.max(0, Math.round(expectedCenter - rowSpacing * 1.5));
            const cropHeight = Math.min(Math.round(rowSpacing * 1.9), canvas.height - cropTop);
            const rowCanvas = document.createElement('canvas');
            rowCanvas.width = canvas.width;
            rowCanvas.height = cropHeight;
            const rowContext = rowCanvas.getContext('2d');
            if (!rowContext) throw new Error('Could not isolate a missed screenshot row.');
            rowContext.drawImage(canvas, 0, cropTop, canvas.width, cropHeight, 0, 0, canvas.width, cropHeight);

            const { data: rowData } = await worker.recognize(rowCanvas, {}, { blocks: true });
            const croppedLines = (rowData.blocks || []).flatMap(block =>
              block.paragraphs.flatMap(paragraph => paragraph.lines)
            );
            const targetCenter = expectedCenter - cropTop;
            const missedLine = croppedLines
              .map(line => ({
                line,
                distance: Math.abs((line.bbox.y0 + line.bbox.y1) / 2 - targetCenter)
              }))
              .filter(candidate => candidate.distance < rowSpacing * 0.6)
              .sort((a, b) => a.distance - b.distance)[0]?.line;

            if (missedLine) {
              lines.push({
                ...missedLine,
                bbox: {
                  ...missedLine.bbox,
                  y0: missedLine.bbox.y0 + cropTop,
                  y1: missedLine.bbox.y1 + cropTop
                }
              });
            }
          }
        }
      }

      if (importMode === 'ai') {
        await worker.setParameters({
          tessedit_pageseg_mode: '7',
          tessedit_char_whitelist: '0123456789'
        });
        const detectedColumns = detectScreenshotColumns(lines, canvas.width);
        const orderCellX = Math.round(canvas.width * detectedColumns[1]);
        const orderCellWidth = Math.round(canvas.width * (detectedColumns[2] + 0.016 - detectedColumns[1]));
        const orderCellHeight = Math.max(1, Math.round(rowSpacing * 0.9));
        for (const line of lines) {
          if (line.bbox.y0 < canvas.height * 0.035) continue;
          const centerY = (line.bbox.y0 + line.bbox.y1) / 2;
          const sourceY = Math.max(0, Math.min(
            canvas.height - orderCellHeight,
            Math.round(centerY - orderCellHeight / 2)
          ));
          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = orderCellWidth * 3;
          cropCanvas.height = orderCellHeight * 3;
          const cropContext = cropCanvas.getContext('2d', { willReadFrequently: true });
          if (!cropContext) throw new Error('Could not isolate an order number for recognition.');
          cropContext.drawImage(
            canvas,
            orderCellX,
            sourceY,
            orderCellWidth,
            orderCellHeight,
            0,
            0,
            cropCanvas.width,
            cropCanvas.height
          );

          const imageData = cropContext.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
          let backgroundLuminance = 0;
          let edgeSamples = 0;
          for (let x = 0; x < cropCanvas.width; x += 4) {
            for (const y of [0, cropCanvas.height - 1]) {
              const offset = (y * cropCanvas.width + x) * 4;
              backgroundLuminance += imageData.data[offset] * 0.299
                + imageData.data[offset + 1] * 0.587
                + imageData.data[offset + 2] * 0.114;
              edgeSamples += 1;
            }
          }
          const isHighlighted = backgroundLuminance / edgeSamples < 150;
          const threshold = isHighlighted ? 130 : 170;
          for (let offset = 0; offset < imageData.data.length; offset += 4) {
            const luminance = imageData.data[offset] * 0.299
              + imageData.data[offset + 1] * 0.587
              + imageData.data[offset + 2] * 0.114;
            const pixel = isHighlighted
              ? (luminance < threshold ? 255 : 0)
              : (luminance < threshold ? 0 : 255);
            imageData.data[offset] = pixel;
            imageData.data[offset + 1] = pixel;
            imageData.data[offset + 2] = pixel;
            imageData.data[offset + 3] = 255;
          }
          cropContext.putImageData(imageData, 0, 0);
          const { data: orderData } = await worker.recognize(cropCanvas);
          line.verifiedOrderId = orderData.text.replace(/\D/g, '').match(/22\d{5}/)?.[0] || '';
        }
      }

      const isDatImport = importMode === 'dat';
      const isNtgImport = importMode === 'ntg';
      let recognizedLoads = isDatImport
        ? parseDatScreenshotLines(lines, canvas.width, canvas.height, brokerName, laneRates)
        : isNtgImport
          ? parseNtgScreenshotLines(lines, canvas.width, canvas.height)
          : parseScreenshotLines(lines, canvas.width, canvas.height, brokerName);
      if (!isDatImport && !isNtgImport && recognizedLoads.length > 0) {
        try {
          const zipModule = await import('zipcodes');
          correctCitiesFromZip(recognizedLoads, zipModule.default || zipModule);
        } catch (error) {
          console.error('Could not use ZIP data to verify screenshot cities:', error);
        }
      }
      const applyDatCityFix = async () => {
        if (!isDatImport || recognizedLoads.length === 0) return;
        try {
          const zipModule = await import('zipcodes');
          correctDatCities(recognizedLoads, zipModule.default || zipModule);
        } catch (error) {
          console.error('Could not verify DAT cities:', error);
        }
      };
      if (isDatImport && recognizedLoads.length === 0) {
        for (const pageSegMode of ['6', '11']) {
          setScreenshotImportProgress('Trying another DAT table recognition mode...');
          await worker.setParameters({ tessedit_pageseg_mode: pageSegMode });
          const { data: retryData } = await worker.recognize(canvas, {}, { blocks: true });
          const retryLines = (retryData.blocks || []).flatMap(block =>
            block.paragraphs.flatMap(paragraph => paragraph.lines)
          );
          const retryLoads = parseDatScreenshotLines(
            retryLines,
            canvas.width,
            canvas.height,
            brokerName,
            laneRates
          );
          if (retryLoads.length > recognizedLoads.length) recognizedLoads = retryLoads;
          if (recognizedLoads.length > 0) break;
        }
      }

      if (isDatImport && recognizedLoads.length > 0) {
        setScreenshotImportProgress('Reading DAT rates...');
        await worker.setParameters({
          tessedit_pageseg_mode: '7',
          tessedit_char_whitelist: '0123456789,$'
        });
        for (const load of recognizedLoads) {
          const crop = load.rateCrop;
          if (!crop || crop.x1 <= crop.x0) continue;
          const miles = Number(load.miles) || 0;
          const isPlausible = value => value >= 100 && value < 100000
            && (!(miles > 0) || (value / miles >= 0.4 && value / miles <= 25));
          const variants = [
            [-0.34, 0.1, 140], [-0.34, 0.1, 110], [-0.34, 0.1, 170],
            [-0.45, 0.02, 140], [-0.3, 0.2, 140], [-0.5, 0.15, 125]
          ];
          let found = 0;
          let fallbackRate = 0;
          for (const [top, bottom, threshold] of variants) {
            const y0 = Math.max(0, Math.round(crop.centerY + crop.rowHeight * top));
            const y1 = Math.min(canvas.height, Math.round(crop.centerY + crop.rowHeight * bottom));
            if (y1 <= y0) continue;
            const scale = 4;
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = (crop.x1 - crop.x0) * scale;
            cropCanvas.height = (y1 - y0) * scale;
            const cropContext = cropCanvas.getContext('2d', { willReadFrequently: true });
            if (!cropContext) break;
            cropContext.imageSmoothingQuality = 'high';
            cropContext.drawImage(canvas, crop.x0, y0, crop.x1 - crop.x0, y1 - y0, 0, 0, cropCanvas.width, cropCanvas.height);
            const cropData = cropContext.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
            for (let offset = 0; offset < cropData.data.length; offset += 4) {
              const luminance = cropData.data[offset] * 0.299 + cropData.data[offset + 1] * 0.587 + cropData.data[offset + 2] * 0.114;
              const pixel = luminance < threshold ? 0 : 255;
              cropData.data[offset] = pixel;
              cropData.data[offset + 1] = pixel;
              cropData.data[offset + 2] = pixel;
              cropData.data[offset + 3] = 255;
            }
            cropContext.putImageData(cropData, 0, 0);
            const { data: rateData } = await worker.recognize(cropCanvas);
            const rateValue = Number(rateData.text.replace(/[^\d]/g, ''));
            if (isPlausible(rateValue)) {
              found = rateValue;
              break;
            }
            if (!fallbackRate && rateValue >= 100 && rateValue < 100000 && /^\$?\d{1,2},?\d{3}\s*$/.test(rateData.text.trim())) {
              fallbackRate = rateValue;
            }
          }
          if (!found) found = fallbackRate;
          if (found) {
            load.rateInput = String(found);
            load.rateSource = 'dat-screenshot';
          } else if (load.rateInput && !isPlausible(Number(load.rateInput))) {
            load.rateInput = '';
            delete load.rateSource;
          }
        }
      }
      await applyDatCityFix();
      recognizedLoads.forEach(load => { delete load.rateCrop; });

      if (recognizedLoads.length === 0) {
        throw new Error(isDatImport
          ? 'No DAT load rows were recognized. Capture the DAT results table straight-on with the Origin, Destination, Pick Up, EQ, and Weight columns visible.'
          : isNtgImport
            ? 'No NTG loads were recognized. Capture the NTG load cards straight-on with the Load #, cities, miles, weight and Total Rate visible.'
          : 'No load rows could be read. Try a clearer, straight-on screenshot that includes the full table.');
      }

      const existingOrders = customerOrdersMap[brokerName] || [];
      const latestRegistry = getLatestExportedRegistry();
      const exportedRecords = getExportedRecordsForCustomer(latestRegistry, brokerName);
      const exportedIds = new Set(exportedRecords.ids);
      const exportedLaneDays = new Set(exportedRecords.laneDays || []);
      let importedLoads = recognizedLoads.filter(load => {
        const laneDayKey = createLaneDayKey(load);
        return !exportedIds.has(normalizeLoadId(load.id)) && (!laneDayKey || !exportedLaneDays.has(laneDayKey));
      });
      const skippedExportedCount = recognizedLoads.length - importedLoads.length;
      let skippedDuplicateCount = 0;
      if (isDatImport) {
        const uniqueLoads = [];
        const seenLaneDays = new Map();
        importedLoads.forEach(load => {
          const laneDayKey = createLaneDayKey(load);
          const previousIndex = laneDayKey ? seenLaneDays.get(laneDayKey) : undefined;
          if (previousIndex === undefined) {
            if (laneDayKey) seenLaneDays.set(laneDayKey, uniqueLoads.length);
            uniqueLoads.push(load);
            return;
          }
          skippedDuplicateCount += 1;
          const previousLoad = uniqueLoads[previousIndex];
          if (!(Number(previousLoad.rateInput) > 0) && Number(load.rateInput) > 0) {
            uniqueLoads[previousIndex] = load;
          }
        });
        const existingByLaneDay = new Map();
        existingOrders.forEach(order => {
          const laneDayKey = createLaneDayKey(order);
          if (laneDayKey && !existingByLaneDay.has(laneDayKey)) {
            existingByLaneDay.set(laneDayKey, order);
          }
        });
        importedLoads = uniqueLoads.flatMap(load => {
          const laneDayKey = createLaneDayKey(load);
          const existingLoad = laneDayKey ? existingByLaneDay.get(laneDayKey) : null;
          if (!existingLoad) return [load];
          if (!(Number(existingLoad.rateInput) > 0) && Number(load.rateInput) > 0) {
            return [{ ...load, id: existingLoad.id }];
          }
          skippedDuplicateCount += 1;
          return [];
        });
      }

      if (importedLoads.length === 0) {
        alert(`Read ${recognizedLoads.length} load rows, but none were added for ${brokerName}.${skippedExportedCount ? ' They were already exported.' : ''}${skippedDuplicateCount ? ' They duplicated a lane and pickup date already imported.' : ''}`);
        return;
      }

      const existingIds = new Set(existingOrders.map(order => order.id));
      const mergeableFields = [
        'pickupTime', 'origCity', 'origSt', 'origZip', 'weight',
        'deliveryTime', 'destCity', 'destSt', 'destZip', 'miles',
        'planningComment', 'rateInput', 'rateSource'
      ];
      const mergedImportedLoads = importedLoads.map(importedLoad => {
        const existingLoad = existingOrders.find(order => order.id === importedLoad.id);
        if (!existingLoad) return importedLoad;
        const mergedLoad = { ...importedLoad, ...existingLoad };
        if (!isDatImport) {
          // A fresh customer screenshot is the source of truth for these fields.
          [
            'eCode', 'route', 'puDate', 'delDate', 'pickupTime', 'origCity', 'origSt', 'origZip',
            'weight', 'deliveryTime', 'destCity', 'destSt', 'destZip', 'miles'
          ].forEach(field => {
            if (String(importedLoad[field] || '').trim()) mergedLoad[field] = importedLoad[field];
          });
        }
        mergeableFields.forEach(field => {
          if (!String(existingLoad[field] || '').trim() && String(importedLoad[field] || '').trim()) {
            mergedLoad[field] = importedLoad[field];
          }
        });
        return mergedLoad;
      });
      const newLoads = mergedImportedLoads.filter(order => !existingIds.has(order.id));
      const mergedOrders = new Map(existingOrders.map(order => [order.id, order]));
      mergedImportedLoads.forEach(order => mergedOrders.set(order.id, order));
      const nextOrders = {
        ...customerOrdersMap,
        [brokerName]: Array.from(mergedOrders.values())
      };
      const saved = persistAppData(brokers, nextOrders);
      setCustomerOrdersMap(nextOrders);
      setSelectedOrder(mergedImportedLoads[0]);
      setSelectedIds([]);
      const unreadableIds = importedLoads.filter(order => order.notes).length;
      const unreadableWeights = importedLoads.filter(order => !order.weight).length;
      const unreadablePickups = importedLoads.filter(order => !order.pickupTime).length;
      const unreadableRates = isDatImport ? importedLoads.filter(order => !(Number(order.rateInput) > 0)).length : 0;
      const updatedLoads = mergedImportedLoads.length - newLoads.length;
      alert(`Read ${recognizedLoads.length} ${isDatImport ? 'DAT ' : ''}load rows for ${brokerName}; added ${newLoads.length} new loads${updatedLoads ? ` and updated ${updatedLoads} existing load${updatedLoads === 1 ? '' : 's'}` : ''}.${skippedExportedCount ? ` Skipped ${skippedExportedCount} load${skippedExportedCount === 1 ? '' : 's'} already exported.` : ''}${skippedDuplicateCount ? ` Skipped ${skippedDuplicateCount} duplicate lane/pickup-date load${skippedDuplicateCount === 1 ? '' : 's'}.` : ''}${saved ? ' They are saved in this browser.' : ' Saving failed; keep this page open and check browser storage.'}${unreadableIds ? ` ${unreadableIds} order number${unreadableIds === 1 ? ' was' : 's were'} unreadable.` : ''}${unreadablePickups ? ` ${unreadablePickups} pickup date/time${unreadablePickups === 1 ? ' was' : 's were'} not recognized; please check those loads.` : ''}${unreadableWeights ? ` ${unreadableWeights} weight${unreadableWeights === 1 ? ' was' : 's were'} not recognized; please check those loads.` : ''}${isDatImport ? `${unreadableRates ? ` ${unreadableRates} DAT rate${unreadableRates === 1 ? ' was' : 's were'} not recognized; enter them manually.` : ' DAT rates were imported from the screenshot.'} Trip values were imported as miles; verify them. Pickup times and the 8:00 AM–4:00 PM delivery window were added. The screenshot does not include a delivery date or ZIP codes; enter those before export.` : ''}`);
    } catch (error) {
      console.error(`${importMode === 'dat' ? 'DAT screenshot' : 'Customer screenshot'} import failed:`, error);
      alert(`${importMode === 'dat' ? 'DAT screenshot' : 'Customer screenshot'} import failed: ${error.message || 'Could not read the image.'}`);
    } finally {
      if (worker) await worker.terminate();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      setIsImportingScreenshot(false);
      setScreenshotImportMode('');
      setScreenshotImportProgress('');
      event.target.value = '';
    }
  };

  const handleExportToLandstar = async () => {
    setExportErrorIds([]);
    const loadsToExport = selectedIds.length > 0
      ? orders.filter(o => selectedIds.includes(o.id))
      : filteredOrders.slice(0, 25);

    if (loadsToExport.length === 0) {
      alert('No loads selected for export!');
      return;
    }

    const normalizedBroker = normalizeCustomerName(selectedBroker).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const customerIdVal = normalizedBroker.includes('593772')
      ? '593772'
      : normalizedBroker.includes('1522166')
        ? '1522166'
        : isRxoCustomer(selectedBroker)
          ? '2429200'
          : (String(selectedBroker).match(/\b\d{5,8}\b/)?.[0] || '9999999');
    const isChCustomer = isCh593772Customer(selectedBroker);
    const allowMissingMiles = isChCustomer;
    let zipModule = null;
    try {
      zipModule = await import('zipcodes');
    } catch (error) {
      console.error('Could not load offline ZIP location data for the Landstar export:', error);
      alert('Could not load the offline ZIP location data needed for the Landstar export.');
      return;
    }
    const zipData = zipModule.default || zipModule;
    const lookupZip = zip => zipData.codes?.[zip] || null;
    const lookupCityState = (city, state) => {
      const cityName = String(city || '').trim();
      const stateCode = String(state || '').trim();
      const exactMatch = zipData.lookupByName?.(cityName, stateCode)?.[0];
      if (exactMatch) return exactMatch;

      const normalizeCity = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const normalizedCity = normalizeCity(cityName);
      if (normalizedCity.length < 5) return null;

      const prefixMatches = (zipData.lookupByState?.(stateCode) || [])
        .filter(location => normalizeCity(location.city).startsWith(normalizedCity));
      const matchingCities = Array.from(new Set(prefixMatches.map(location => normalizeCity(location.city))));
      return matchingCities.length === 1 ? prefixMatches[0] || null : null;
    };
    let representativeZipCount = 0;
    const representativeZipExamples = [];

    const validationErrors = [];
    const exportData = loadsToExport.map(ord => {
      const rowErrors = [];
      const enteredOriginZip = String(ord.origZip || '').replace(/\D/g, '').slice(0, 5);
      const enteredDestinationZip = String(ord.destZip || '').replace(/\D/g, '').slice(0, 5);
      const enteredOriginLocation = enteredOriginZip.length === 5 ? lookupZip(enteredOriginZip) : null;
      const enteredDestinationLocation = enteredDestinationZip.length === 5 ? lookupZip(enteredDestinationZip) : null;
      const originLocation = enteredOriginLocation || (true
        ? lookupCityState(ord.origCity, ord.origSt)
        : null);
      const destinationLocation = enteredDestinationLocation || (true
        ? lookupCityState(ord.destCity, ord.destSt)
        : null);
      const originZip = originLocation?.zip || (enteredOriginLocation ? enteredOriginZip : '');
      const destinationZip = destinationLocation?.zip || (enteredDestinationLocation ? enteredDestinationZip : '');
      const originState = String(ord.origSt || originLocation?.state || '').trim().toUpperCase();
      const destinationState = String(ord.destSt || destinationLocation?.state || '').trim().toUpperCase();
      const originCity = getLandstarCity(ord.origCity, originLocation);
      const destinationCity = getLandstarCity(ord.destCity, destinationLocation);
      const originStateMatchesZip = !ord.origSt || !originLocation || originState === originLocation.state;
      const destinationStateMatchesZip = !ord.destSt || !destinationLocation || destinationState === destinationLocation.state;
      const originZipWasResolved = !enteredOriginLocation && Boolean(originLocation);
       const destinationZipWasResolved = !enteredDestinationLocation && Boolean(destinationLocation);
      if (originZipWasResolved) representativeZipCount += 1;
      if (destinationZipWasResolved) representativeZipCount += 1;
      if ((originZipWasResolved || destinationZipWasResolved) && representativeZipExamples.length < 5) {
        representativeZipExamples.push(
          `${ord.id}: ${originZipWasResolved ? `${originCity}, ${originState} ${originZip}` : ''}${originZipWasResolved && destinationZipWasResolved ? ' → ' : ''}${destinationZipWasResolved ? `${destinationCity}, ${destinationState} ${destinationZip}` : ''}`
        );
      }
      const puParts = (ord.pickupTime || '').split(' - ');
      const spacedDelivery = Array.from(
        String(ord.deliveryTime || '').matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):?(\d{2})/g)
      ).map(match => `${match[1]}/${match[2]}/${match[3].length === 2 ? `20${match[3]}` : match[3]} ${match[4]}${match[5]}`);
      const delParts = spacedDelivery.length >= 2
        ? spacedDelivery
        : (ord.deliveryTime || '').split(' - ');
      const pickupFrom = toExcelDateTime(puParts[0]);
      const pickupThru = toExcelDateTime(puParts[1] || puParts[0], puParts[0]);
      const deliveryFrom = toExcelDateTime(delParts[0]);
      const deliveryThru = toExcelDateTime(delParts[1] || delParts[0], delParts[0]);
      const equipment = getLandstarEquipmentCode(ord.eCode);
      const commodity = getLandstarCommodity(ord.eCode);
      const miles = Number(String(ord.miles || '').replace(/[^0-9.]/g, ''));
      const weight = parseWeightPounds(ord.weight);
      const rate = Number(String(ord.rateInput || '').replace(/[$,]/g, ''));
      const postingCode = String(ord.postingCode || 'ANQ').trim().toUpperCase();
      const visibilityCode = 'ANQ';
      const brokerable = ['true', 'y'].includes(String(ord.brokerable || '').trim().toLowerCase()) ? 'Y' : 'N';
      const today = new Date();
      const todaySerial = (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(1899, 11, 30)) / 86400000;

      if (!ord.origCity) rowErrors.push('origin city');
      if (!originState || !stateCodes.has(originState)) rowErrors.push('origin state');
      if (!originStateMatchesZip) rowErrors.push(`origin state must match ZIP ${originZip} (${originLocation.state})`);
      if (!ord.destCity) rowErrors.push('destination city');
      if (!destinationState || !stateCodes.has(destinationState)) rowErrors.push('destination state');
      if (!destinationStateMatchesZip) rowErrors.push(`destination state must match ZIP ${destinationZip} (${destinationLocation.state})`);
      if (pickupFrom === null || pickupThru === null) {
        rowErrors.push('pickup date/time (enter valid dates as MM/DD/YYYY HHMM - HHMM)');
      }
      else if (pickupThru < todaySerial) rowErrors.push('pickup end date cannot be in the past');
      else if (pickupThru < pickupFrom) rowErrors.push('pickup end must be after pickup start');
      if (deliveryFrom === null || deliveryThru === null) rowErrors.push('delivery date and time');
      else if (deliveryThru < todaySerial) rowErrors.push('delivery end date cannot be in the past');
      else if (deliveryThru < deliveryFrom) rowErrors.push('delivery end must be after delivery start');
      if (pickupThru !== null && deliveryThru !== null && Math.floor(deliveryThru) <= Math.floor(pickupThru)) {
        rowErrors.push('delivery end date must be later than pickup end date');
      }
      if (!equipment) rowErrors.push('valid equipment');
      if (!['CGAPP', 'HAZMAT', 'CHEM'].includes(commodity)) rowErrors.push('valid commodity');
      if (!allowMissingMiles && !(miles > 0)) rowErrors.push('miles');
      if (weight === null || weight > 999999) {
        rowErrors.push('weight (enter whole pounds from 1 to 999,999)');
      }
      if (!(rate > 0) || !['user-entered', 'dat-screenshot'].includes(ord.rateSource)) {
        rowErrors.push('rate (enter a current DAT quote or import one from a DAT screenshot)');
      }

      if (rowErrors.length) validationErrors.push(`Order ${ord.id}: ${rowErrors.join(', ')}`);

      return {
        "Customer ID(Required)": customerIdVal,
        "Posting Call Back 10 Digits Phone Number": "4845756486",
        "Origin City": originCity,
        "Origin Zipcode(Required)": originZip,
        "Origin State": originState,
        "Origin Country(Required)": "US",
        "Destination City": destinationCity,
        "Destination Zipcode(Required)": destinationZip,
        "Destination State": destinationState,
        "Destination Country(Required)": "US",
        "Pickup Date (From)(Required)": pickupFrom,
        "Pickup Date (Thru)(Required)": pickupThru,
        "Delivery Date (From)(Required)": deliveryFrom,
        "Delivery Date (Thru)(Required)": deliveryThru,
        "Load Posting Code": postingCode,
        "Visibility Code": visibilityCode,
        "Bill as Miles": allowMissingMiles && !(miles > 0) ? '' : miles,
        "Equipment 1(Required)": equipment,
        "Equipment 2": String(ord.eCode || '').trim().toUpperCase() === 'VT' ? '53VN' : '',
        "Equipment 3": "",
        "Weight(Required)": weight ?? '',
        "Rate Type(Required)": "Flat Rate",
        "Rate(Required)": rate,
        "Commodity": getLandstarCommodityValue(commodity),
        "Brokerable": brokerable,
        "Carrier Amt": rate,
        "Carrier Load Alerts": "",
        "Load Attributes": "",
        "Comments": "",
        "Fuel Surcharge Rate Type": "",
        "Fuel Surcharge": "",
        "Team": String(ord.eCode || '').trim().toUpperCase() === 'VT' ? 'true' : 'false'
      };
    });

    if (validationErrors.length) {
      const failedIds = validationErrors
        .map(error => error.match(/^Order\s+([^:]+):/)?.[1])
        .filter(Boolean);
      setExportErrorIds(failedIds);
      const firstFailedOrder = loadsToExport.find(order => failedIds.includes(String(order.id)));
      if (firstFailedOrder) setSelectedOrder(firstFailedOrder);
      const visibleErrors = validationErrors.slice(0, 10).join('\n');
      const additionalCount = validationErrors.length - 10;
      alert(`The spreadsheet was not created because Landstar-required load data needs correction:\n\n${visibleErrors}${additionalCount > 0 ? `\n…and ${additionalCount} more load(s).` : ''}\n\nCorrect these fields and export again.`);
      return;
    }

    const missingZipLoads = exportData.filter(record =>
      !record['Origin Zipcode(Required)'] || !record['Destination Zipcode(Required)']
    );
    if (missingZipLoads.length && !window.confirm(
      `${missingZipLoads.length} load${missingZipLoads.length === 1 ? ' has' : 's have'} a blank origin or destination ZIP code. The spreadsheet will be created with those ZIP fields blank, but Landstar may reject those loads because its form requires ZIP-based location details.\n\nContinue anyway?`
    )) {
      return;
    }

    if (representativeZipCount > 0 && !window.confirm(
      `No ZIP code was entered for ${representativeZipCount} location${representativeZipCount === 1 ? '' : 's'} on this customer's loads. The export will use the first ZIP found for each matching city and state. These representative ZIPs may not match the exact pickup or delivery address; verify them before posting.\n\n${representativeZipExamples.join('\n')}${representativeZipCount > representativeZipExamples.length ? '\n…' : ''}\n\nContinue with this export?`
    )) {
      return;
    }

    const exportedIds = new Set(loadsToExport.map(order => normalizeLoadId(order.id)));
    let exportBlob;
    try {
      const templateResponse = await fetch(`${import.meta.env.BASE_URL}landstar-bulk-template.xlsx`);
      if (!templateResponse.ok) {
        throw new Error(`Template download returned HTTP ${templateResponse.status}.`);
      }
      const templateBytes = await templateResponse.arrayBuffer();
      const workbook = XLSX.read(templateBytes, { type: 'array' });
      const worksheet = workbook.Sheets.Loads;
      if (!worksheet) throw new Error('The Landstar template does not contain its required Loads sheet.');

      const range = XLSX.utils.decode_range(worksheet['!ref']);
      const headers = Array.from({ length: range.e.c + 1 }, (_, column) =>
        worksheet[XLSX.utils.encode_cell({ r: 0, c: column })]?.v
      );
      const normalizeHeader = header => String(header || '').replace(/[\r\n]/g, '').trim().toLowerCase();
      ['Origin State', 'Destination State'].forEach(header => {
        if (!headers.some(existing => normalizeHeader(existing) === normalizeHeader(header))) {
          headers.push(header);
        }
      });
      if (!headers.some(existing => normalizeHeader(existing) === 'team')) {
        headers.push('Team');
      }
      range.e.c = headers.length - 1;
      const headerIndexes = new Map(headers.map((header, index) => [normalizeHeader(header), index]));
      const requiredHeaders = ['Customer ID(Required)', 'Origin City', 'Load Posting Code', 'Commodity'];
      const missingHeaders = requiredHeaders.filter(header => !headerIndexes.has(normalizeHeader(header)));
      if (missingHeaders.length) {
        throw new Error(`The supplied Landstar template is missing required columns: ${missingHeaders.join(', ')}.`);
      }

      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(templateBytes);
      const mainNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
      const documentRelationshipsNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
      const packageRelationshipsNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
      const parser = new DOMParser();
      const serializer = new XMLSerializer();
      const parseXml = (xml, partName) => {
        const document = parser.parseFromString(xml, 'application/xml');
        if (document.getElementsByTagName('parsererror').length) {
          throw new Error(`The Landstar template contains invalid XML in ${partName}.`);
        }
        return document;
      };
      const workbookDocument = parseXml(
        await zip.file('xl/workbook.xml').async('string'),
        'xl/workbook.xml'
      );
      const relationshipsDocument = parseXml(
        await zip.file('xl/_rels/workbook.xml.rels').async('string'),
        'xl/_rels/workbook.xml.rels'
      );
      const loadsSheet = Array.from(workbookDocument.getElementsByTagNameNS(mainNamespace, 'sheet'))
        .find(sheet => sheet.getAttribute('name') === 'Loads');
      const relationshipId = loadsSheet?.getAttributeNS(documentRelationshipsNamespace, 'id');
      const loadsRelationship = Array.from(
        relationshipsDocument.getElementsByTagNameNS(packageRelationshipsNamespace, 'Relationship')
      ).find(relationship => relationship.getAttribute('Id') === relationshipId);
      if (!loadsRelationship) throw new Error('Could not locate the Loads worksheet in the Landstar template.');

      const worksheetTarget = loadsRelationship.getAttribute('Target');
      const worksheetPath = worksheetTarget.startsWith('/')
        ? worksheetTarget.slice(1)
        : `xl/${worksheetTarget}`;
      const worksheetFile = zip.file(worksheetPath);
      const sharedStringsFile = zip.file('xl/sharedStrings.xml');
      if (!worksheetFile || !sharedStringsFile) {
        throw new Error('The Landstar template is missing its Loads worksheet or shared-string table.');
      }

      const worksheetDocument = parseXml(await worksheetFile.async('string'), worksheetPath);
      const sharedStringsDocument = parseXml(
        await sharedStringsFile.async('string'),
        'xl/sharedStrings.xml'
      );
      const sheetData = worksheetDocument.getElementsByTagNameNS(mainNamespace, 'sheetData')[0];
      const sharedStrings = sharedStringsDocument.getElementsByTagNameNS(mainNamespace, 'sst')[0];
      if (!sheetData || !sharedStrings) {
        throw new Error('The Landstar template has an invalid Loads worksheet or shared-string table.');
      }

      const sharedItems = () => Array.from(sharedStrings.getElementsByTagNameNS(mainNamespace, 'si'));
      const getSharedStringText = item =>
        Array.from(item.getElementsByTagNameNS(mainNamespace, 't'))
          .map(text => text.textContent || '')
          .join('');
      const sharedStringIndexes = new Map(sharedItems().map((item, index) => [getSharedStringText(item), index]));
      let sharedStringReferenceDelta = 0;
      const getSharedStringIndex = value => {
        if (sharedStringIndexes.has(value)) return sharedStringIndexes.get(value);
        const item = sharedStringsDocument.createElementNS(mainNamespace, 'si');
        const text = sharedStringsDocument.createElementNS(mainNamespace, 't');
        if (value !== value.trim()) {
          text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
        }
        text.textContent = value;
        item.appendChild(text);
        const index = sharedItems().length;
        sharedStrings.appendChild(item);
        sharedStringIndexes.set(value, index);
        return index;
      };

      const rows = Array.from(sheetData.getElementsByTagNameNS(mainNamespace, 'row'));
      const rowByNumber = new Map(rows.map(row => [Number(row.getAttribute('r')), row]));
      const templateRow = rowByNumber.get(2);
      if (!templateRow) throw new Error('The Landstar template does not include its first load row.');
      const getOrCreateRow = rowNumber => {
        if (rowByNumber.has(rowNumber)) return rowByNumber.get(rowNumber);
        const newRow = templateRow.cloneNode(true);
        newRow.setAttribute('r', String(rowNumber));
        Array.from(newRow.getElementsByTagNameNS(mainNamespace, 'c')).forEach(cell => {
          cell.setAttribute('r', cell.getAttribute('r').replace(/\d+$/, String(rowNumber)));
        });
        const nextRow = Array.from(sheetData.getElementsByTagNameNS(mainNamespace, 'row'))
          .find(row => Number(row.getAttribute('r')) > rowNumber);
        sheetData.insertBefore(newRow, nextRow || null);
        rowByNumber.set(rowNumber, newRow);
        return newRow;
      };
      const getOrCreateCell = (row, rowNumber, column) => {
        const address = XLSX.utils.encode_cell({ r: rowNumber - 1, c: column });
        const existingCell = Array.from(row.getElementsByTagNameNS(mainNamespace, 'c'))
          .find(cell => cell.getAttribute('r') === address);
        if (existingCell) return existingCell;

        const cell = worksheetDocument.createElementNS(mainNamespace, 'c');
        cell.setAttribute('r', address);
        const nextCell = Array.from(row.getElementsByTagNameNS(mainNamespace, 'c'))
          .find(candidate => XLSX.utils.decode_cell(candidate.getAttribute('r')).c > column);
        row.insertBefore(cell, nextCell || null);
        return cell;
      };
      const setCellValue = (cell, value) => {
        const previousType = cell.getAttribute('t');
        if (previousType === 's') sharedStringReferenceDelta -= 1;
        Array.from(cell.children)
          .filter(child => ['f', 'v', 'is'].includes(child.localName))
          .forEach(child => cell.removeChild(child));

        if (value === '' || value == null) {
          cell.removeAttribute('t');
          return;
        }

        const valueElement = worksheetDocument.createElementNS(mainNamespace, 'v');
        if (typeof value === 'number') {
          cell.removeAttribute('t');
          valueElement.textContent = String(value);
        } else {
          cell.setAttribute('t', 's');
          valueElement.textContent = String(getSharedStringIndex(String(value)));
          sharedStringReferenceDelta += 1;
        }
        cell.appendChild(valueElement);
      };

      const headerRow = getOrCreateRow(1);
      headers.forEach((header, column) => {
        setCellValue(getOrCreateCell(headerRow, 1, column), header);
      });

      for (let rowNumber = 2; rowNumber <= range.e.r + 1; rowNumber += 1) {
        const row = rowByNumber.get(rowNumber);
        if (!row) continue;
        Array.from(row.getElementsByTagNameNS(mainNamespace, 'c'))
          .forEach(cell => setCellValue(cell, ''));
      }

      exportData.forEach((record, recordIndex) => {
        const rowNumber = recordIndex + 2;
        const row = getOrCreateRow(rowNumber);
        const recordValues = new Map(
          Object.entries(record).map(([header, value]) => [normalizeHeader(header), value])
        );
        headers.forEach((header, column) => {
          const value = recordValues.get(normalizeHeader(header)) ?? '';
          setCellValue(getOrCreateCell(row, rowNumber, column), value);
        });
      });

      const lastDataRow = exportData.length + 1;
      const dimensions = worksheetDocument.getElementsByTagNameNS(mainNamespace, 'dimension');
      if (dimensions.length) {
        dimensions[0].setAttribute(
          'ref',
          `A1:${XLSX.utils.encode_col(range.e.c)}${Math.max(lastDataRow, range.e.r + 1)}`
        );
      }
      if (lastDataRow > 26) {
        Array.from(worksheetDocument.getElementsByTagNameNS(mainNamespace, 'dataValidation'))
          .forEach(validation => {
            validation.setAttribute(
              'sqref',
              validation.getAttribute('sqref').replace(/T2:T26/g, `T2:T${lastDataRow}`)
            );
          });
      }

      const sharedStringCount = Number(sharedStrings.getAttribute('count'));
      sharedStrings.setAttribute(
        'count',
        String((Number.isFinite(sharedStringCount) ? sharedStringCount : 0) + sharedStringReferenceDelta)
      );
      sharedStrings.setAttribute('uniqueCount', String(sharedItems().length));
      zip.file(worksheetPath, serializer.serializeToString(worksheetDocument));
      zip.file('xl/sharedStrings.xml', serializer.serializeToString(sharedStringsDocument));
      exportBlob = await zip.generateAsync({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });
    } catch (error) {
      console.error('Could not prepare the official Landstar bulk template:', error);
      alert(`Could not create a spreadsheet from the official Landstar template: ${error.message || 'Please try again.'}`);
      return;
    }

    try {
      const downloadUrl = URL.createObjectURL(exportBlob);
      const downloadLink = document.createElement('a');
      downloadLink.href = downloadUrl;
      downloadLink.download = `Landstar_Bulk_${selectedBroker.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (error) {
      console.error('Could not create the Landstar bulk spreadsheet:', error);
      alert('The Landstar bulk spreadsheet could not be created. Please try again.');
      return;
    }

    const exportedAt = new Date().toISOString();
    const exportedLoadIds = new Set(loadsToExport.map(order => normalizeLoadId(order.id)));
    const registryKey = normalizeCustomerName(selectedBroker);
    const latestRegistry = getLatestExportedRegistry();
    const previousRecords = getExportedRecordsForCustomer(latestRegistry, selectedBroker);
    const nextExportedRecords = {
      ids: Array.from(new Set([
        ...previousRecords.ids,
        ...loadsToExport.map(ord => normalizeLoadId(ord.id))
      ])),
      laneDays: Array.from(new Set([
        ...(previousRecords.laneDays || []),
        ...loadsToExport.map(createLaneDayKey).filter(Boolean)
      ]))
    };
    const nextExportedRegistry = { ...latestRegistry, [registryKey]: nextExportedRecords };
    let exportedRegistrySaved = true;
    try {
      localStorage.setItem('landstar_exportedLoads', JSON.stringify(nextExportedRegistry));
      setExportedLoadRegistry(nextExportedRegistry);
    } catch (error) {
      exportedRegistrySaved = false;
      console.error('Could not save exported load records:', error);
    }
    const nextOrders = {
      ...customerOrdersMap,
      [selectedBroker]: orders.map(order => exportedLoadIds.has(normalizeLoadId(order.id))
        ? { ...order, status: 'ENT', tag: 'ENT', landstarExportedAt: exportedAt }
        : order)
    };
    const saved = persistAppData(brokers, nextOrders);
    setExportErrorIds([]);
    setCustomerOrdersMap(nextOrders);
    setSelectedIds(prev => prev.filter(id => !exportedIds.has(normalizeLoadId(id))));
    setSelectedOrder(
      selectedOrder && exportedLoadIds.has(normalizeLoadId(selectedOrder.id))
        ? nextOrders[selectedBroker].find(order => normalizeLoadId(order.id) === normalizeLoadId(selectedOrder.id)) || selectedOrder
        : selectedOrder || nextOrders[selectedBroker][0] || null
    );

    alert(`Exported ${loadsToExport.length} loads for ${selectedBroker} and moved them to ENT. Exported loads stay in ENT for 30 days, then are automatically removed.${saved ? '' : ' Browser storage could not be updated, so the archive may not persist after refresh.'}${exportedRegistrySaved ? ' Future imports will skip these exported loads.' : ' Warning: exported-load history could not be saved, so duplicate imports may occur after refresh.'}`);
  };

  const filteredOrders = orders.filter(ord => {
    const matchesFilter = filter === 'ALL' || ord.status === filter;
    const normalizedSearch = searchQuery.trim().toLowerCase();
    const matchesSearch = !normalizedSearch
      || String(ord.id || '').toLowerCase().includes(normalizedSearch)
      || String(ord.route || '').toLowerCase().includes(normalizedSearch)
      || String(ord.planningComment || '').toLowerCase().includes(normalizedSearch);
    const miles = Number(String(ord.miles || '').replace(/[^0-9.]/g, ''));
    const minimumMiles = loadFilters.minMiles === '' ? null : Number(loadFilters.minMiles);
    const maximumMiles = loadFilters.maxMiles === '' ? null : Number(loadFilters.maxMiles);
    const matchesMinimumMiles = minimumMiles === null || (Number.isFinite(miles) && miles >= minimumMiles);
    const matchesMaximumMiles = maximumMiles === null || (Number.isFinite(miles) && miles <= maximumMiles);
    return matchesFilter && matchesSearch && matchesMinimumMiles && matchesMaximumMiles;
  }).sort((left, right) => {
    if (!laneSort) return 0;
    const descending = laneSort.endsWith('-desc');
    const sortKey = laneSort.replace(/-asc$|-desc$/, '');
    const [leftCity, leftState] = sortKey === 'origin'
      ? [left.origCity, left.origSt]
      : [left.destCity, left.destSt];
    const [rightCity, rightState] = sortKey === 'origin'
      ? [right.origCity, right.origSt]
      : [right.destCity, right.destSt];
    const comparison = `${leftCity || ''}, ${leftState || ''}`.localeCompare(
      `${rightCity || ''}, ${rightState || ''}`,
      undefined,
      { sensitivity: 'base', numeric: true }
    );
    return (descending ? -comparison : comparison) || String(left.id).localeCompare(String(right.id));
  });

  const handleRateKeyDown = event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const rate = Number(String(selectedOrder?.rateInput || '').replace(/[$,]/g, ''));
    if (!(rate > 0) || !Number.isFinite(rate)) return;

    const currentIndex = filteredOrders.findIndex(order => order.id === selectedOrder.id);
    const nextOrder = currentIndex >= 0 ? filteredOrders[currentIndex + 1] : null;
    if (nextOrder) setSelectedOrder(nextOrder);
  };

  const entCount = orders.filter(o => o.status === 'ENT').length;

  const handleBackupExport = () => {
    const data = {};
    Object.keys(localStorage)
      .filter(key => key.startsWith('landstar_') && key !== 'landstar_gmailClientId')
      .forEach(key => { data[key] = localStorage.getItem(key); });
    const blob = new Blob([JSON.stringify({ app: 'landstar-tms-reader', savedAt: new Date().toISOString(), data })], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `landstar-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleBackupImport = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      const entries = Object.entries(backup?.data || {})
        .filter(([key, value]) => key.startsWith('landstar_') && typeof value === 'string');
      if (backup?.app !== 'landstar-tms-reader' || entries.length === 0) {
        throw new Error('This is not a Landstar TMS backup file.');
      }
      if (!window.confirm(`Restore this backup (${new Date(backup.savedAt).toLocaleString()})? It will replace the customers, loads, rates and exported-load history in this browser.`)) return;
      entries.forEach(([key, value]) => localStorage.setItem(key, value));
      window.location.reload();
    } catch (error) {
      alert(`Could not restore the backup: ${error.message}`);
    }
  };

  return (
    <div className="flex h-screen bg-[#0b132b] text-white overflow-hidden font-sans">
      {/* Left Sidebar - Order List */}
      <div className="w-96 bg-[#121829] border-r border-[#1c2541] flex flex-col">
        <div className="p-3 border-b border-[#1c2541] bg-[#161f36]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-200">Landstar TMS</span>
            <div className="space-x-1 flex items-center">
              <label className={`bg-emerald-600 hover:bg-emerald-500 px-2 py-0.5 text-[10px] font-bold rounded cursor-pointer text-white inline-flex items-center ${isImportingScreenshot ? 'opacity-60 cursor-wait' : ''}`} title="AI Screenshot Import">
                <span>{isImportingScreenshot && screenshotImportMode === 'ai' ? screenshotImportProgress : '✨ Customer Screenshot'}</span>
                <input type="file" accept="image/*" onChange={handleScreenshotImport} className="hidden" disabled={isImportingScreenshot} />
              </label>
              <label className={`bg-indigo-600 hover:bg-indigo-500 px-2 py-0.5 text-[10px] font-bold rounded cursor-pointer text-white inline-flex items-center ${isImportingScreenshot ? 'opacity-60 cursor-wait' : ''}`} title="Import load rows from a DAT load-board screenshot">
                <span>{isImportingScreenshot && screenshotImportMode === 'dat' ? screenshotImportProgress : '📷 Import DAT Loads'}</span>
                <input type="file" accept="image/*" onChange={event => handleScreenshotImport(event, 'dat')} className="hidden" disabled={isImportingScreenshot} />
              </label>
              <label className={`bg-amber-600 hover:bg-amber-500 px-2 py-0.5 text-[10px] font-bold rounded cursor-pointer text-white inline-flex items-center ${isImportingScreenshot ? 'opacity-60 cursor-wait' : ''}`} title="Import loads from an NTG load-board screenshot">
                <span>{isImportingScreenshot && screenshotImportMode === 'ntg' ? screenshotImportProgress : '🚚 Import NTG Loads'}</span>
                <input type="file" accept="image/*" onChange={event => handleScreenshotImport(event, 'ntg')} className="hidden" disabled={isImportingScreenshot} />
              </label>
              <label className="bg-blue-600 hover:bg-blue-500 px-2 py-0.5 text-[10px] font-bold rounded cursor-pointer text-white inline-flex items-center" title="Import Excel Spreadsheet">
                <span>📂 Import Excel</span>
                <input type="file" accept=".xlsx, .xls, .csv" onChange={handleExcelImport} className="hidden" />
              </label>
              <button
                type="button"
                onClick={() => setIsGmailImportOpen(open => !open)}
                className="bg-red-700 hover:bg-red-600 px-2 py-0.5 text-[10px] font-bold rounded text-white"
                title="Search Gmail for loads"
              >
                Import Gmail
              </button>
              <button
                onClick={handleExportToLandstar}
                className="bg-purple-600 hover:bg-purple-500 px-2 py-0.5 text-[10px] font-bold rounded text-white cursor-pointer"
              >
                📥 Export
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-1 mb-2">
            <button
              type="button"
              onClick={handleBackupExport}
              className="bg-slate-700 hover:bg-slate-600 px-2 py-0.5 text-[10px] font-bold rounded text-white cursor-pointer"
              title="Download all customers, loads and rates as a backup file"
            >
              💾 Backup
            </button>
            <label className="bg-slate-700 hover:bg-slate-600 px-2 py-0.5 text-[10px] font-bold rounded cursor-pointer text-white inline-flex items-center" title="Restore customers, loads and rates from a backup file">
              <span>📤 Restore</span>
              <input type="file" accept=".json,application/json" onChange={handleBackupImport} className="hidden" />
            </label>
          </div>

          {isGmailImportOpen && (
            <div className="mb-3 rounded border border-red-700/60 bg-[#0b132b] p-2.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-white">Gmail Load Import</span>
                <button
                  type="button"
                  onClick={() => setIsGmailImportOpen(false)}
                  className="text-xs text-gray-400 hover:text-white"
                  aria-label="Close Gmail import"
                >
                  Close
                </button>
              </div>
              <p className="text-[10px] leading-relaxed text-gray-400 mb-2">
                Setup required once: in Google Cloud Console, create a project, enable Gmail API, configure the OAuth consent screen and create an OAuth Client ID for a Web application. Add this app’s origin (localhost:5173 and your deployed origin) to Authorized JavaScript origins. Do not enter a client secret here.
              </p>
              <label className="block text-[10px] text-gray-400 mb-1" htmlFor="gmail-client-id">Google OAuth Web client ID</label>
              <input
                id="gmail-client-id"
                type="text"
                value={gmailClientId}
                onChange={event => setGmailClientId(event.target.value)}
                placeholder="...apps.googleusercontent.com"
                className="w-full bg-[#161f36] border border-[#1c2541] rounded p-1.5 text-xs text-white placeholder-gray-500 mb-2"
              />
              <label className="block text-[10px] text-gray-400 mb-1" htmlFor="gmail-search-query">Gmail search query</label>
              <input
                id="gmail-search-query"
                type="text"
                value={gmailQuery}
                onChange={event => setGmailQuery(event.target.value)}
                placeholder="newer_than:7d or from:sender@example.com"
                className="w-full bg-[#161f36] border border-[#1c2541] rounded p-1.5 text-xs text-white placeholder-gray-500 mb-2"
              />
              <p className="text-[10px] text-gray-500 mb-2">
                Imports only the newest email matching this query. Only requests Gmail read-only access after you authorize Google. Pickup date comes from date headings; delivery dates are left blank if absent.
              </p>
              {isCh593772Customer(selectedBroker) && (
                <p className="text-[10px] text-amber-300 mb-2">
                  This customer’s Gmail imports calculate driving miles with Google Routes. Enable the Routes API and configure GOOGLE_MAPS_API_KEY on the server (or in your local .env file); never put the key in browser code.
                </p>
              )}
              {gmailImportProgress && <p role="status" className="text-[10px] text-amber-300 mb-2">{gmailImportProgress}</p>}
              <button
                type="button"
                onClick={handleGmailImport}
                disabled={!gmailAuthReady || gmailImportProgress.startsWith('Searching') || gmailImportProgress.startsWith('Reading') || gmailImportProgress.startsWith('Calculating')}
                className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-50 disabled:cursor-wait px-2 py-1.5 text-xs font-bold rounded text-white"
              >
                {gmailImportProgress && gmailImportProgress.startsWith('Reading')
                  ? gmailImportProgress
                  : gmailAuthReady ? 'Authorize Gmail & Import Matching Loads' : 'Loading Google Authorization...'}
              </button>
            </div>
          )}

          {/* Customer / Broker Buttons */}
          <div className="flex flex-col gap-1.5 my-2">
            <span className="text-[11px] text-gray-400 font-bold uppercase tracking-wider">Customers / Brokers:</span>
            {brokers.map(broker => (
              editingBroker === broker ? (
                <form key={broker} onSubmit={(e) => handleSaveEditBroker(broker, e)} className="flex items-center space-x-1 w-full">
                  <input
                    type="text"
                    value={editBrokerInput}
                    onChange={(e) => setEditBrokerInput(e.target.value)}
                    autoFocus
                    className="bg-[#0b132b] border border-blue-500 rounded px-2 py-1 text-[11px] text-white outline-none flex-1"
                  />
                  <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 text-[11px] rounded font-bold">Save</button>
                  <button type="button" onClick={() => setEditingBroker(null)} className="bg-gray-600 hover:bg-gray-500 text-white px-1.5 py-1 text-[11px] rounded">Cancel</button>
                </form>
              ) : (
                <div
                  key={broker}
                  className={`flex items-center justify-between px-2.5 py-1.5 text-[11px] rounded font-medium border transition-colors ${selectedBroker === broker ? 'bg-blue-600/30 border-blue-500 text-white' : 'bg-[#1c2541] border-[#253259] text-gray-300 hover:bg-[#253259]'}`}
                >
                  <span
                    className="truncate flex-1 cursor-pointer"
                    onClick={() => handleSelectBroker(broker)}
                  >
                    {broker} {selectedBroker === broker && ' ✓'}
                  </span>
                  <div className="flex items-center space-x-1 ml-2">
                    <button
                      onClick={() => { setEditingBroker(broker); setEditBrokerInput(broker); }}
                      title="Edit Customer"
                      className="bg-slate-700 hover:bg-blue-600 text-gray-200 hover:text-white px-1.5 py-0.5 rounded text-[10px]"
                    >
                      ✏️ Edit
                    </button>
                    <button
                      onClick={(e) => handleDeleteBroker(broker, e)}
                      title="Delete Customer"
                      className="bg-slate-700 hover:bg-red-600 text-gray-200 hover:text-white px-1.5 py-0.5 rounded text-[10px]"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            ))}

            {isAddingBroker ? (
              <form onSubmit={handleAddBroker} className="flex items-center space-x-1 mt-1 w-full">
                <input
                  type="text"
                  placeholder="Customer ID / Name..."
                  value={newBrokerInput}
                  onChange={(e) => setNewBrokerInput(e.target.value)}
                  autoFocus
                  className="bg-[#0b132b] border border-blue-500 rounded px-2 py-1 text-[11px] text-white outline-none flex-1"
                />
                <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 text-[11px] rounded font-bold">Add</button>
                <button type="button" onClick={() => setIsAddingBroker(false)} className="bg-gray-600 hover:bg-gray-500 text-white px-1.5 py-1 text-[11px] rounded">Cancel</button>
              </form>
            ) : (
              <button
                onClick={() => setIsAddingBroker(true)}
                className="mt-1 px-2.5 py-1 text-[11px] rounded font-medium bg-[#1c2541] hover:bg-blue-600 text-blue-300 hover:text-white transition-colors text-left"
              >
                + Add Customer
              </button>
            )}
          </div>

          <div className="flex items-center justify-between text-[11px] text-gray-400 mb-2">
            <span>{filteredOrders.length} shown · {orders.length} loads · {entCount} ENT</span>
            <span className={storageError ? 'text-amber-400' : 'text-emerald-400'} title={storageError || 'Loads are saved in this browser.'}>
              {storageError || '🔒 Saved in this browser'}
            </span>
          </div>

          <div className="flex items-center justify-between mb-2">
            <div className="flex space-x-1">
              {['ALL', 'OPEN', 'ON HOLD', 'ENT'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setFilter(tab)}
                  className={`px-2 py-1 text-[11px] rounded font-semibold ${filter === tab ? 'bg-blue-600 text-white' : 'bg-[#1c2541] text-gray-400'}`}
                >
                  {tab}
                </button>
              ))}
            </div>
            {selectedIds.length > 0 && (
              <button
                onClick={handleDeleteSelected}
                className="bg-red-600 hover:bg-red-700 text-white text-[10px] px-2 py-1 rounded font-bold cursor-pointer"
              >
                Delete Selected ({selectedIds.length})
              </button>
            )}
          </div>

          <div className="flex items-center justify-between mt-1 mb-1 px-1">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                onChange={() => handleSelectAll(filteredOrders)}
                checked={filteredOrders.length > 0 && filteredOrders.every(o => selectedIds.includes(o.id))}
                className="cursor-pointer accent-blue-600"
              />
              <span className="text-[11px] text-gray-400">Select All</span>
            </div>
            <button
              onClick={handleSelectFirst25}
              className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold px-2 py-0.5 rounded cursor-pointer"
            >
              Select First 25
            </button>
          </div>

          <div className="relative mt-1">
            <input
              type="text"
              placeholder="🔍 Search order, city, comment..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-1.5 text-xs text-white placeholder-gray-500 outline-none focus:border-blue-500"
            />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <input
              type="number"
              min="0"
              placeholder="Min miles"
              aria-label="Minimum miles"
              value={loadFilters.minMiles}
              onChange={e => setLoadFilters(prev => ({ ...prev, minMiles: e.target.value }))}
              className="min-w-0 bg-[#0b132b] border border-[#1c2541] rounded p-1.5 text-xs text-white placeholder-gray-500 outline-none focus:border-blue-500"
            />
            <input
              type="number"
              min="0"
              placeholder="Max miles"
              aria-label="Maximum miles"
              value={loadFilters.maxMiles}
              onChange={e => setLoadFilters(prev => ({ ...prev, maxMiles: e.target.value }))}
              className="min-w-0 bg-[#0b132b] border border-[#1c2541] rounded p-1.5 text-xs text-white placeholder-gray-500 outline-none focus:border-blue-500"
            />
          </div>
          <div className="mt-1.5">
            <select
              aria-label="Sort loads by city and state"
              value={laneSort}
              onChange={e => setLaneSort(e.target.value)}
              className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-1.5 text-xs text-white outline-none focus:border-blue-500"
            >
              <option value="">Sort by city/state (default)</option>
              <option value="origin-asc">Origin city/state: A to Z</option>
              <option value="origin-desc">Origin city/state: Z to A</option>
              <option value="destination-asc">Destination city/state: A to Z</option>
              <option value="destination-desc">Destination city/state: Z to A</option>
            </select>
          </div>
          {(loadFilters.minMiles || loadFilters.maxMiles || laneSort) && (
            <button
              type="button"
              onClick={() => {
                setLoadFilters({ minMiles: '', maxMiles: '' });
                setLaneSort('');
              }}
              className="mt-1 text-[10px] text-blue-300 hover:text-white"
            >
              Clear lane filters
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {filteredOrders.length === 0 ? (
            <div className="text-center text-gray-500 text-xs py-10">No loads found for {selectedBroker}. Click "📂 Import Excel" above!</div>
          ) : (
            filteredOrders.map((ord) => (
              <div
                key={ord.id}
                onClick={() => setSelectedOrder(ord)}
                className={`p-3 rounded-lg cursor-pointer border transition-all flex items-start space-x-2.5 ${
                  exportErrorIds.includes(String(ord.id))
                    ? 'bg-red-950/50 border-red-500 shadow-md'
                    : selectedOrder?.id === ord.id
                      ? 'bg-[#1c2541] border-blue-500 shadow-md'
                      : 'bg-[#161f36]/60 border-transparent hover:bg-[#1c2541]/50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(ord.id)}
                  onChange={(e) => handleToggleSelect(ord.id, e)}
                  className="mt-1 cursor-pointer accent-blue-600"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-sm text-blue-400">{ord.id}</span>
                      {exportErrorIds.includes(String(ord.id)) && (
                        <span className="bg-red-700 text-white text-[9px] px-1.5 py-0.5 rounded font-bold">EXPORT ERROR</span>
                      )}
                      <span className="bg-blue-900/60 text-blue-300 text-[10px] px-1.5 py-0.5 rounded font-mono" title={getEquipmentDescription(ord.eCode)}>{ord.eCode}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${ord.status === 'ENT' ? 'bg-emerald-900/60 text-emerald-300' : ord.status === 'ON HOLD' ? 'bg-amber-900/60 text-amber-300' : 'bg-blue-900/60 text-blue-300'}`}>{ord.status}</span>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${ord.tag === 'ENT' ? 'bg-emerald-600 text-white' : ord.tag === 'HOLD' ? 'bg-amber-600 text-white' : 'bg-blue-600 text-white'}`}>{ord.tag}</span>
                  </div>
                  <div className="text-xs font-medium text-gray-200 mb-1 truncate">{ord.route}</div>
                  <div className="text-[11px] text-gray-400">{ord.puDate} {ord.delDate}</div>
                  {ord.planningComment && <div className="mt-1 text-[11px] text-amber-300 font-semibold truncate">{ord.planningComment}</div>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-y-auto p-6 bg-[#0b132b]">
        {selectedOrder ? (
          <>
            <div className="flex items-center justify-between bg-[#161f36] px-4 py-3 rounded-lg mb-6 border border-[#1c2541]">
              <div className="flex items-center space-x-3">
                <span className="text-xs font-bold text-gray-400">MOVE TO:</span>
                <button onClick={() => handleStatusChange('OPEN')} className="bg-emerald-600 hover:bg-emerald-500 px-3 py-1 text-xs font-bold rounded text-white cursor-pointer">OPEN</button>
                <button onClick={() => handleStatusChange('ON HOLD')} className="bg-amber-600 hover:bg-amber-500 px-3 py-1 text-xs font-bold rounded text-white cursor-pointer">ON HOLD</button>
                <button onClick={() => handleStatusChange('ENT')} className="bg-emerald-700 hover:bg-emerald-600 px-3 py-1 text-xs font-bold rounded text-white cursor-pointer">ENT</button>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleOpenLandstarLoads} className="bg-blue-600 hover:bg-blue-500 px-3 py-1 text-xs rounded text-white font-medium cursor-pointer">Open Landstar + Copy Lane</button>
                <button onClick={handleExportToLandstar} className="bg-purple-600 hover:bg-purple-500 px-3 py-1 text-xs rounded text-white font-medium cursor-pointer">📥 Export to Landstar Bulk Excel & Move to ENT</button>
              </div>
            </div>

            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <h2 className="text-xl font-bold tracking-wide">ORDER #{selectedOrder.id}</h2>
                <button
                  onClick={() => copyToClipboard(selectedOrder.id, 'Order #')}
                  className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2.5 py-1 rounded font-medium flex items-center space-x-1 cursor-pointer"
                >
                  <span>📋 Copy Order #</span>
                </button>
                <button
                  onClick={handleOpenDatRateView}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-3 py-1 rounded font-semibold cursor-pointer shadow flex items-center space-x-1"
                >
                  <span>🔎 Open DAT RateView</span>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2.5 py-1 rounded font-semibold ${selectedOrder.tag === 'ENT' ? 'bg-emerald-600 text-white' : selectedOrder.tag === 'HOLD' ? 'bg-amber-600 text-white' : 'bg-blue-600 text-white'}`}>{selectedOrder.tag}</span>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer"
                >
                  Delete Load
                </button>
              </div>
            </div>

            <div className="space-y-4 bg-[#161f36]/40 p-5 rounded-xl border border-[#1c2541]">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">ORDER #</label>
                  <div className="flex gap-1">
                    <input type="text" value={selectedOrder.id} onChange={(e) => handleInputChange('id', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white outline-none" />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(selectedOrder.id, 'Order #')}
                      title="Copy Order #"
                      className="shrink-0 bg-slate-700 hover:bg-slate-600 text-white px-2.5 rounded text-xs cursor-pointer"
                    >
                      📋
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">VISIBILITY GROUP</label>
                  <input type="text" value="ANQ" readOnly className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">EQUIPMENT</label>
                  <input type="text" value={selectedOrder.eCode} onChange={(e) => handleInputChange('eCode', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white outline-none" />
                  <div className="text-[11px] text-emerald-400 mt-1 font-mono">{getEquipmentDescription(selectedOrder.eCode)}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Brokerable (true / false)</label>
                  <input type="text" value={selectedOrder.brokerable || 'false'} onChange={(e) => handleInputChange('brokerable', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono" placeholder="false" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">POSTING CODE</label>
                  <input
                    type="text"
                    value={selectedOrder.postingCode || 'ANQ'}
                    onChange={(e) => handleInputChange('postingCode', e.target.value)}
                    className="w-full bg-[#0b132b] border border-emerald-500/60 rounded p-2 text-sm text-white font-mono"
                  />
                </div>
              </div>

              <div className="border border-[#1c2541] bg-[#121829]/60 p-4 rounded-lg">
                <div className="mb-3">
                  <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wide flex items-center">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 mr-2"></span> Pickup Details
                  </h3>
                </div>
               
                <div className="mb-3">
                  <label className="text-xs text-gray-400 block mb-1">Pickup Time (Early - Late)</label>
                  <input
                    type="text"
                    value={selectedOrder.pickupTime || ''}
                    onChange={(e) => handleInputChange('pickupTime', e.target.value)}
                    className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  {renderCopyableField('Origin City', 'origCity')}
                  {renderCopyableField('Origin State', 'origSt')}
                  {renderCopyableField('Origin ZIP', 'origZip')}
                </div>
               
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Weight</label>
                    <div className="flex space-x-2">
                      <input type="text" value={selectedOrder.weight} onChange={(e) => handleInputChange('weight', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white" />
                      <button onClick={() => copyToClipboard(selectedOrder.weight, 'Weight')} className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-xs cursor-pointer">📋 Copy</button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border border-[#1c2541] bg-[#121829]/60 p-4 rounded-lg">
                <div className="mb-3">
                  <h3 className="text-xs font-bold text-blue-400 uppercase tracking-wide flex items-center">
                    <span className="w-2 h-2 rounded-full bg-blue-400 mr-2"></span> Delivery Details
                  </h3>
                </div>

                <div className="mb-3">
                  <label className="text-xs text-gray-400 block mb-1">Delivery Time (Early - Late)</label>
                  <input
                    type="text"
                    value={selectedOrder.deliveryTime || ''}
                    placeholder={String(selectedBroker || '').includes('965974') ? 'MM/DD/YY 08:00  MM/DD/YY 16:00' : ''}
                    onChange={(e) => handleInputChange('deliveryTime', e.target.value)}
                    className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  {renderCopyableField('Destination City', 'destCity')}
                  {renderCopyableField('Destination State', 'destSt')}
                  {renderCopyableField('Destination ZIP', 'destZip')}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Miles</label>
                    <div className="flex space-x-2">
                      <input type="text" value={selectedOrder.miles} onChange={(e) => handleInputChange('miles', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white" />
                      <button onClick={() => copyToClipboard(selectedOrder.miles, 'Miles')} className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-xs cursor-pointer">📋 Copy</button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Rate Type</label>
                    <input
                      type="text"
                      value="Flat Rate"
                      readOnly
                      className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs text-emerald-400 font-bold">Rate ($) - actual DAT quote</label>
                      <span className="text-[10px] bg-emerald-950 text-emerald-300 px-1 py-0.2 rounded font-mono border border-emerald-600/40">{selectedOrder.rateSource === 'dat-screenshot' ? 'From DAT screenshot' : 'Manual'}</span>
                    </div>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={['user-entered', 'dat-screenshot'].includes(selectedOrder.rateSource) ? selectedOrder.rateInput || '' : ''}
                        onChange={(e) => handleInputChange('rateInput', e.target.value)}
                        onKeyDown={handleRateKeyDown}
                        placeholder="Enter DAT quote"
                        className="w-full bg-[#0b132b] border border-emerald-500/60 rounded p-2 text-sm text-white font-mono font-bold"
                      />
                      <button
                        type="button"
                        onClick={() => copyToClipboard(selectedOrder.rateInput || '', 'Rate')}
                        title="Copy Rate"
                        className="shrink-0 bg-slate-700 hover:bg-slate-600 text-white px-2.5 rounded text-xs cursor-pointer"
                      >
                        📋
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">Saved automatically for this customer, lane, and equipment. Press Enter after entering a rate to go to the next load.</p>
                  </div>
                </div>
                <div className="mt-3">
                  <label className="text-xs text-gray-400 block mb-1">Commodity</label>
                  <input
                    type="text"
                    value={getLandstarCommodity(selectedOrder.eCode)}
                    readOnly
                    className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white"
                  />
                </div>
              </div>

              {/* Carrier & Equipment Assignment */}
              <div className="border border-[#1c2541] bg-[#121829]/60 p-4 rounded-lg">
                <h3 className="text-xs font-bold text-purple-400 uppercase tracking-wide mb-3">Carrier & Equipment Assignment</h3>
                <div className="grid grid-cols-2 gap-4 mb-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Carrier Name</label>
                    <input type="text" value={selectedOrder.carrier} onChange={(e) => handleInputChange('carrier', e.target.value)} placeholder="Enter carrier name" className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Driver Name</label>
                    <input type="text" value={selectedOrder.driver} onChange={(e) => handleInputChange('driver', e.target.value)} placeholder="Enter driver name" className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Truck #</label>
                    <input type="text" value={selectedOrder.truck} onChange={(e) => handleInputChange('truck', e.target.value)} placeholder="Truck number" className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Trailer #</label>
                    <input type="text" value={selectedOrder.trailer} onChange={(e) => handleInputChange('trailer', e.target.value)} placeholder="Trailer number" className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                  </div>
                </div>
              </div>

              {/* Planning Comment Box */}
              <div className="bg-amber-950/30 border border-amber-600/50 p-3 rounded-lg">
                <span className="text-[11px] font-bold text-amber-400 block mb-1 uppercase">Planning Comment</span>
                <input
                  type="text"
                  value={selectedOrder.planningComment}
                  onChange={(e) => handleInputChange('planningComment', e.target.value)}
                  className="w-full bg-[#0b132b] border border-amber-600/30 rounded p-1.5 text-xs text-amber-200 font-mono outline-none"
                />
              </div>

              {/* DAT RateView Reference */}
              <div className="border border-emerald-500/40 bg-emerald-950/20 p-4 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-emerald-400 uppercase tracking-wide">DAT RateView</span>
                  <div>
                    <button
                      onClick={handleOpenDatRateView}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] px-3 py-1.5 rounded font-semibold cursor-pointer shadow"
                    >
                      🔎 Open DAT + Copy Load Details
                    </button>
                  </div>
                </div>
                <div className="text-xs text-gray-300 font-mono bg-[#0b132b] p-2.5 rounded border border-[#1c2541]">
                  Opens [RateView - DAT iQ](https://iq.dat.com/rateview) and copies this load’s details so you can paste the lane into DAT and enter its quote here. Automatic DAT search/fill is unavailable without an authorized DAT integration.
                </div>
              </div>

              <div className="flex justify-between items-center pt-4 border-t border-[#1c2541]">
                <button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded text-sm font-semibold w-full transition-colors shadow-lg cursor-pointer">Save Changes</button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <p>No loads available for this customer. Click "📂 Import Excel" at the top left to load your spreadsheet!</p>
          </div>
        )}
      </div>
    </div>
  );
}



