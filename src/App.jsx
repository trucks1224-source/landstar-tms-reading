import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from './lib/supabase';
import { detectScreenshotGrid, readScreenshotGrid } from './lib/screenshotTable.js';

const exportedLoadRetentionMs = 30 * 24 * 60 * 60 * 1000;

// ==========================================
// ZIP CODE AUTO-FILL DICTIONARY & HELPER
// ==========================================
const zipDatabase = {
  "PARCHMENT, MI": "49004",
  "STONE MOUNTAIN, GA": "30083",
  // Add other recurring lanes or missing cities here as needed:
};

function autoFillLoadZipCodes(loads) {
  return loads.map(load => {
    const updated = { ...load };
    
    // Check and fill Origin ZIP if missing
    if (!updated.origZip && updated.origCity && updated.origSt) {
      const originKey = `${updated.origCity.trim().toUpperCase()}, ${updated.origSt.trim().toUpperCase()}`;
      if (zipDatabase[originKey]) {
        updated.origZip = zipDatabase[originKey];
      }
    }

    // Check and fill Destination ZIP if missing
    if (!updated.destZip && updated.destCity && updated.destSt) {
      const destKey = `${updated.destCity.trim().toUpperCase()}, ${updated.destSt.trim().toUpperCase()}`;
      if (zipDatabase[destKey]) {
        updated.destZip = zipDatabase[destKey];
      }
    }

    return updated;
  });
}

function removeExpiredExportedLoads(customerOrders, now = Date.now()) {
  let changed = false;
  const nextOrders = {};
  Object.entries(customerOrders).forEach(([customer, loads]) => {
    nextOrders[customer] = loads.filter(load => {
      if (load.status !== 'ENT' || !load.landstarExportedAt) return true;
      const exportedAt = Date.parse(load.landstarExportedAt);
      const keep = !Number.isFinite(exportedAt) || now - exportedAt < exportedLoadRetentionMs;
      if (!keep) changed = true;
      return keep;
    });
  });
  return changed ? nextOrders : customerOrders;
}

function markLoadsExported(loads, exportedIds, exportedAt) {
  return loads.map(load => exportedIds.has(String(load.id))
    ? { ...load, status: 'ENT', tag: 'ENT', landstarExportedAt: exportedAt }
    : load);
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
  if (lines[0]?.screenshotColumns) return lines[0].screenshotColumns;
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
  const isParaImport = isParaCustomer(selectedBroker);
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
    } else if (isParaImport && hourText.length <= 2) {
      // Para's clipped cells show hours, not minutes; a lone zero uses 08:00.
      hour = hourText === '0' && !meridiem ? 8 : Number(hourText);
      minute = 0;
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
    const equipment = line.verifiedEquipmentCode
      || equipmentText.toUpperCase().match(/\b(V53|VM|VT|VZ|VE|VR|RZ|R|F|SD|VAN|V)\b/)?.[0]?.replace(/^V53$/, 'V') || '';
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
    const weightValue = /^1\d{5}$/.test(rawWeight) && Number(rawWeight.slice(1)) >= 1000
      ? rawWeight.slice(1)
      : rawWeight;
    const normalizedComment = weightFromComment
      ? planningComment.replace(/^\s*\d[\d,. ]{2,8}\s*/, '').trim()
      : planningComment;

    return {
      id: id || `IMG-${Date.now()}-${index}`,
      eCode: isTeamEquipment(equipment) ? 'V' : equipment || (isRxoCustomer(selectedBroker) ? 'VAN:VAN' : 'VZ'),
      team: isTeamEquipment(equipment) ? 'true' : 'false',
      status: isParaImport && line.orderNumberHighlighted ? 'ON HOLD' : 'OPEN',
      tag: isParaImport && line.orderNumberHighlighted ? 'HOLD' : 'OPEN',
      ...(isParaImport && typeof line.orderNumberHighlighted === 'boolean'
        ? { screenshotStatus: line.orderNumberHighlighted ? 'ON HOLD' : 'OPEN' }
        : {}),
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
      miles: normalizeMilesValue(mileage) || '400',
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

function findNtgCards(lines, imageWidth, imageHeight) {
  const words = lines.flatMap(line => line.words || [])
    .map(word => {
      const x0 = word.bbox.x0 / imageWidth;
      const x1 = word.bbox.x1 / imageWidth;
      return { text: String(word.text || '').trim(), x0, x1, cx: (x0 + x1) / 2, cy: (word.bbox.y0 + word.bbox.y1) / 2, h: word.bbox.y1 - word.bbox.y0 };
    })
    .filter(word => word.text);
  const markers = words
    .filter(word => (word.cx > 0.5 && /^(sto\w{0,2}|weight|total)$/i.test(word.text)) || (word.x0 < 0.2 && /^\d{7}$/.test(word.text)))
    .sort((a, b) => a.cy - b.cy);
  const clusters = [];
  markers.forEach(word => {
    const last = clusters[clusters.length - 1];
    if (last && word.cy - last.cy < imageHeight * 0.02) {
      last.count += 1;
      last.cy += (word.cy - last.cy) / last.count;
    } else {
      clusters.push({ cy: word.cy, count: 1 });
    }
  });
  const anchors = clusters;
  const spacing = anchors.length > 1
    ? anchors.slice(1).map((anchor, index) => anchor.cy - anchors[index].cy).sort((a, b) => a - b)[Math.floor((anchors.length - 1) / 2)]
    : imageHeight;
  const cards = anchors.map(anchor => {
    const top = anchor.cy - spacing * 0.2;
    const bottom = anchor.cy + spacing * 0.8;
    return { cy: anchor.cy, top, bottom, words: words.filter(word => word.cy >= top && word.cy < bottom) };
  });
  return { cards, spacing };
}

function parseNtgScreenshotLines(lines, imageWidth, imageHeight) {
  const { cards: anchors } = findNtgCards(lines, imageWidth, imageHeight);
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
    const times = Array.from(cleaned.slice(dateMatch.index + dateMatch[0].length).matchAll(/(\d{1,2})\s*[:;.-]\s*(\d{2})/g))
      .map(match => `${match[1].padStart(2, '0')}${match[2]}`);
    const start = times[0] || '0800';
    const end = times[1] || (times[0] ? times[0] : '1600');
    return `${date} ${start} - ${end}`;
  };

  return anchors.map((anchor, index) => {
    const card = anchor.words;
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
    const isFlatbed = /flat\s*bed|\bflat\b/i.test(equipmentText);
    const tags = [/hazmat/i.test(equipmentText) && 'Hazmat', /tanker/i.test(equipmentText) && 'Tanker (N) Endorsement'].filter(Boolean);
    const shortDate = value => value.replace(/^(\d{2})\/(\d{2})\/\d{4}\s+(\d{4}).*$/, '$1/$2 $3');
    return {
      id: idWord ? idWord.text : `NTG-${Date.now()}-${index}`,
      eCode: /straight\s*truck/i.test(equipmentText) ? 'D-LG' : /sprinter|box\s*truck/i.test(equipmentText) ? 'D-LG,D-ST' : isFlatbed ? 'F' : isReefer ? (/\bvan\b/i.test(equipmentText) ? 'VR' : tags.includes('Hazmat') ? 'RZ' : 'R') : tags.includes('Hazmat') ? 'VZ' : 'V',
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

function parseDatRateText(text) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (/\/\s*mi\b/i.test(line)) continue;
    const match = line.match(/^\$?\s*(\d{1,3}(?:,\d{3})+|\d{3,5})(?:\.00)?\s*$/);
    if (match) {
      const rate = Number(match[1].replace(/,/g, ''));
      if (rate >= 100 && rate < 100000) return rate;
    }
  }
  return 0;
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
      && !/[$]|\/\s*mi\b/i.test(text)
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
      .replace(/\$?\s*\d[\d,.]*\s*[/°*]\s*mi\b/gi, ' ')
      .replace(/\/\s*mi\b/gi, ' ')
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
    if (!line.words?.length) return;
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
    const savedLaneRate = getSavedLaneRate(laneRates, selectedBroker, order);
    if (savedLaneRate && (!order.rateInput || getFixedLaneRate(selectedBroker, order))) {
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
    case 'VE': return 'VAN:VAN';
    case 'VZ': return 'VAN:VAN, VAN:53VN, REFR:REFR';
    case 'VAN':
    case 'V': return 'VAN:VAN, VAN:53VN';
    case 'VM':
    case 'VT': return 'VAN:VAN, VAN:53VN';
    case 'VR': return 'VAN:VAN, REFR:REFR';
    case 'R': return 'REFR:REFR';
    case 'RZ': return 'REFR:REFR';
    case 'F': return '48FL, 53FL, FLAT';
    case 'SD': return 'STEP:SD';
    case 'D-LG': return 'D-LG';
    case 'D-LG,D-ST': return 'D-LG, D-ST';
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
    const timeRange = text.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):?(\d{2})\s*(AM|PM)?\s*(?:-|–|—|to)\s*(\d{1,2}):?(\d{2})\s*(AM|PM)?$/i
    );
    if (timeRange) {
      const to24 = (h, m, meridiem) => {
        let hour = Number(h);
        if (meridiem) {
          if (hour < 1 || hour > 12) return null;
          hour = hour % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
        }
        return hour > 23 || Number(m) > 59 ? null : `${String(hour).padStart(2, '0')}${m}`;
      };
      const start = to24(timeRange[4], timeRange[5], timeRange[6]);
      const end = to24(timeRange[7], timeRange[8], timeRange[9] || timeRange[6]);
      const year = timeRange[3].length === 2 ? `20${timeRange[3]}` : timeRange[3];
      if (start && end) {
        return `${timeRange[1].padStart(2, '0')}/${timeRange[2].padStart(2, '0')}/${year} ${start} - ${end}`;
      }
      return text;
    }
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

function formatRxoBusinessHours(dateTime, endTime) {
  const dateMatch = String(dateTime || '').match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  if (!dateMatch) return dateTime;
  const [, month, day, yearText] = dateMatch;
  const year = yearText.length === 2 ? `20${yearText}` : yearText;
  const date = `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${year}`;
  return `${date} 0800 - ${endTime}`;
}

function applyRxoPayerBusinessHours(loads, customer) {
  if (normalizeCustomerName(customer) !== rxoPayerCustomerName) return loads;
  return loads.map(load => ({
    ...load,
    pickupTime: formatRxoBusinessHours(load.pickupTime || load.puDate, '2000'),
    deliveryTime: formatRxoBusinessHours(load.deliveryTime || load.delDate, '1200')
  }));
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

// ==========================================
// C.H. ROBINSON LOAD-BOARD SCREENSHOT (date-grouped table with Weight and Bin/rate columns)
// ==========================================
function findChHeaders(lines) {
  const words = lines.flatMap(line => line.words || []);
  const find = pattern => words.filter(word => pattern.test(word.text)).sort((a, b) => a.bbox.y0 - b.bbox.y0)[0];
  const headers = {
    origin: find(/^origin$/i),
    ost: find(/^ost$/i),
    destination: find(/^destination$/i),
    dst: find(/^dst$/i),
    pickup: find(/^pickup$/i),
    mode: find(/^mode$/i),
    bin: find(/^bin$/i)
  };
  return Object.values(headers).every(Boolean) ? headers : null;
}

function getChColumnBounds(headers, imageWidth) {
  const margin = imageWidth * 0.008;
  return {
    originLeft: headers.origin.bbox.x0 - margin * 1.5,
    ostLeft: headers.ost.bbox.x0 - margin,
    destinationLeft: headers.destination.bbox.x0 - margin,
    dstLeft: headers.dst.bbox.x0 - margin,
    pickupLeft: headers.pickup.bbox.x0 - margin,
    modeLeft: headers.mode.bbox.x0 - margin,
    binLeft: headers.bin.bbox.x0 - margin
  };
}

// The board shows weights like "17.007.9 lbs" or "8.496 lbs" because OCR confuses commas and periods.
function parseChWeight(text) {
  const raw = String(text || '').match(/\d[\d.,]*/)?.[0]?.replace(/[.,]+$/, '');
  if (!raw) return 0;
  const parts = raw.split(/[.,]/);
  if (parts.length === 1) return Number(parts[0]);
  const last = parts[parts.length - 1];
  const value = last.length === 3
    ? Number(parts.join(''))
    : Number(`${parts.slice(0, -1).join('')}.${last}`);
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function parseChScreenshotLines(lines, imageWidth, imageHeight, selectedBroker, laneRates, strips = {}) {
  const headers = findChHeaders(lines);
  if (!headers) return { loads: [], skippedLtl: 0, skippedNoDate: 0 };
  const bounds = getChColumnBounds(headers, imageWidth);
  const pad = value => String(value).padStart(2, '0');
  const cellText = (line, left, right) => (line.words || [])
    .filter(word => {
      const center = (word.bbox.x0 + word.bbox.x1) / 2;
      return center >= left && center < right;
    })
    .sort((a, b) => a.bbox.x0 - b.bbox.x0)
    .map(word => word.text)
    .join(' ');
  const cleanCity = text => text.toUpperCase().replace(/[^A-Z\s.'-]/g, ' ').replace(/\s+/g, ' ').trim();
  const sortedLines = [...lines].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const rowCenters = sortedLines
    .filter(line => /(?<!\d)\d{9}(?!\d)/.test(line.text))
    .map(line => (line.bbox.y0 + line.bbox.y1) / 2);
  const gaps = rowCenters.slice(1).map((center, index) => center - rowCenters[index]).filter(gap => gap > 4).sort((a, b) => a - b);
  const rowGap = gaps[Math.floor(gaps.length / 2)] || imageHeight * 0.012;
  const nearestStrip = (items, y) => (items || [])
    .map(item => ({ ...item, distance: Math.abs(item.y - y) }))
    .filter(item => item.distance <= rowGap * 0.55)
    .sort((a, b) => a.distance - b.distance)[0];

  let pickupDate = '';
  let skippedLtl = 0;
  let skippedNoDate = 0;
  const seenIds = new Set();
  const parsedRows = [];
  sortedLines.forEach(line => {
    const heading = line.text.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(20\d{2})\s*-\s*[A-Za-z]{3}/);
    if (heading) {
      pickupDate = `${pad(heading[1])}/${pad(heading[2])}/${heading[3]}`;
      return;
    }
    const idMatch = line.text.match(/(?<!\d)(\d{9})(?!\d)/);
    if (!idMatch || idMatch.index > 12 || seenIds.has(idMatch[1])) return;
    if (!pickupDate) {
      skippedNoDate += 1;
      return;
    }
    const y = (line.bbox.y0 + line.bbox.y1) / 2;
    const modeText = cellText(line, bounds.modeLeft, bounds.modeLeft + (bounds.binLeft - bounds.modeLeft) * 0.3)
      .toUpperCase().replace(/[^A-Z,]/g, '');
    const rowText = line.text.toUpperCase();
    if (/LTL/.test(modeText) || /\sLTL\s/.test(` ${rowText} `)) {
      skippedLtl += 1;
      return;
    }
    seenIds.add(idMatch[1]);

    const notes = ['Imported from CH screenshot; delivery date/time and miles are not on the board.'];
    const origin = cleanCity(cellText(line, bounds.originLeft, bounds.ostLeft));
    const destination = cleanCity(cellText(line, bounds.destinationLeft, bounds.dstLeft));
    if (!origin || !destination) return;
    const readState = (stripItems, left, right) => {
      const fromStrip = nearestStrip(stripItems, y)?.text || '';
      if (stateCodes.has(fromStrip)) return fromStrip;
      const fromRow = cellText(line, left, right).toUpperCase().replace(/[^A-Z]/g, '');
      return stateCodes.has(fromRow) ? fromRow : '';
    };
    const originState = readState(strips.ost, bounds.ostLeft, bounds.destinationLeft);
    const destinationState = readState(strips.dst, bounds.dstLeft, bounds.pickupLeft);

    const pickupCell = cellText(line, bounds.pickupLeft, bounds.modeLeft);
    const time = pickupCell.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/)
      || line.text.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
    const validTime = time && Number(time[1]) <= 23 && Number(time[3]) <= 23 && Number(time[2]) <= 59 && Number(time[4]) <= 59;
    if (!validTime) notes.push('Pickup hours could not be read; verify them.');
    const pickupHours = validTime
      ? `${pad(time[1])}${time[2]} - ${pad(time[3])}${time[4]}`
      : '0800 - 1600';

    const weight = parseChWeight(line.text.match(/(\d[\d.,]*)\s*[Il1|]bs\b/i)?.[1]);
    if (!weight) notes.push('Weight could not be read; enter it before export.');

    const binText = nearestStrip(strips.bin, y)?.text || '';
    const rateText = binText.match(/\d{3,4}/)?.[0]
      || line.text.match(/[Il1|]bs\s+(\d{3,4})\b/i)?.[1]
      || '';
    const rate = Number(rateText);
    const hasRate = rate >= 100 && rate <= 20000;

    const mode = /^R/.test(modeText) ? 'R' : /^F/.test(modeText) ? 'F' : 'V';
    const order = {
      id: idMatch[1],
      eCode: mode,
      status: 'OPEN',
      tag: 'OPEN',
      route: '',
      puDate: `PU: ${pickupDate}`,
      delDate: 'DFL: Upcoming',
      pickupTime: `${pickupDate} ${pickupHours}`,
      deliveryTime: '',
      origCity: origin,
      origSt: originState,
      origZip: '',
      weight: weight ? `${weight} lbs` : '',
      destCity: destination,
      destSt: destinationState,
      destZip: '',
      miles: '',
      planningComment: 'Imported from CH screenshot',
      carrier: '',
      driver: '',
      truck: '',
      trailer: '',
      rateInput: hasRate ? String(rate) : '',
      ...(hasRate ? { rateSource: 'user-entered' } : {}),
      brokerable: 'false',
      notes: notes.join(' ')
    };
    if (!order.rateInput) {
      const savedLaneRate = getSavedLaneRate(laneRates, selectedBroker, order);
      if (savedLaneRate) {
        order.rateInput = savedLaneRate;
        order.rateSource = 'user-entered';
      }
    }
    parsedRows.push(order);
  });

  // A state the OCR could not read is taken from another row of this screenshot with the same city.
  const statesByCity = {};
  const record = (city, state) => {
    if (!state) return;
    const counts = statesByCity[city] = statesByCity[city] || {};
    counts[state] = (counts[state] || 0) + 1;
  };
  parsedRows.forEach(order => {
    record(order.origCity, order.origSt);
    record(order.destCity, order.destSt);
  });
  const likelyState = city => Object.entries(statesByCity[city] || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const loads = parsedRows.map(order => {
    const origSt = order.origSt || likelyState(order.origCity);
    const destSt = order.destSt || likelyState(order.destCity);
    const missingState = !origSt || !destSt;
    return {
      ...order,
      origSt,
      destSt,
      route: `${order.origCity}${origSt ? `, ${origSt}` : ''} → ${order.destCity}${destSt ? `, ${destSt}` : ''}`,
      notes: missingState ? `${order.notes} A state could not be read; enter it before export.` : order.notes
    };
  });
  return { loads, skippedLtl, skippedNoDate };
}

async function readChScreenshot(worker, canvas, lines, brokerName, laneRates, scale) {
  const headers = findChHeaders(lines);
  if (!headers) return { loads: [], skippedLtl: 0, skippedNoDate: 0 };
  const bounds = getChColumnBounds(headers, canvas.width);
  // Reading each narrow column on its own is far more accurate than reading it inside the full table.
  const readStrip = async (left, right, whitelist) => {
    const x0 = Math.max(0, Math.round(left));
    const x1 = Math.min(canvas.width, Math.round(right));
    if (x1 - x0 < 8) return [];
    const factor = Math.max(1, 4 / scale);
    const margin = 40;
    const strip = document.createElement('canvas');
    strip.width = Math.round((x1 - x0) * factor) + margin * 2;
    strip.height = Math.round(canvas.height * factor) + margin * 2;
    const context = strip.getContext('2d', { willReadFrequently: true });
    if (!context) return [];
    context.fillStyle = '#fff';
    context.fillRect(0, 0, strip.width, strip.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(canvas, x0, 0, x1 - x0, canvas.height, margin, margin, (x1 - x0) * factor, canvas.height * factor);
    // Highlighted rows (yellow, green, gray) confuse OCR, so light backgrounds are whitened while dark text stays.
    const pixels = context.getImageData(0, 0, strip.width, strip.height);
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      const luminance = pixels.data[offset] * 0.299 + pixels.data[offset + 1] * 0.587 + pixels.data[offset + 2] * 0.114;
      const value = luminance >= 205 ? 255 : luminance;
      pixels.data[offset] = value;
      pixels.data[offset + 1] = value;
      pixels.data[offset + 2] = value;
      pixels.data[offset + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: whitelist });
    const { data } = await worker.recognize(strip, {}, { blocks: true });
    return (data.blocks || [])
      .flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines))
      .map(line => ({
        y: ((line.bbox.y0 + line.bbox.y1) / 2 - margin) / factor,
        text: line.text.replace(/\s+/g, '')
      }));
  };
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const strips = {
    ost: await readStrip(bounds.ostLeft, bounds.destinationLeft, letters),
    dst: await readStrip(bounds.dstLeft, bounds.pickupLeft, letters),
    bin: await readStrip(bounds.binLeft, canvas.width, '0123456789')
  };
  await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' });
  return parseChScreenshotLines(lines, canvas.width, canvas.height, brokerName, laneRates, strips);
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
    const savedLaneRate = getSavedLaneRate(laneRates, selectedBroker, order);
    if (savedLaneRate) {
      order.rateInput = savedLaneRate;
      order.rateSource = 'user-entered';
    }
    loads.push(order);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const dateHeading = lines[index].match(/\b(\d{1,2}\/(\d{1,2})\/(?:\d{2}|\d{4}))\s*-\s*[A-Za-z]{3,9}\b/);
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
  return autoFillLoadZipCodes(loads);
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

function normalizeMilesValue(value) {
  const compact = String(value ?? '').replace(/[\s,]/g, '');
  if (/^\d{1,4}(\.\d+)?$/.test(compact)) return compact;
  const decimal = compact.match(/(\d{1,4})\.(\d)/);
  if (decimal) return `${decimal[1]}.${decimal[2]}`;
  const digits = compact.replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(0, -6) : digits;
}

function isTeamEquipment(value) {
  return ['VM', 'VT'].includes(String(value || '').trim().toUpperCase());
}

function getRatePerMile(rate, miles) {
  const rateValue = Number(String(rate || '').replace(/[$,]/g, ''));
  const mileValue = Number(String(miles || '').replace(/[,\s]/g, ''));
  if (!(rateValue > 0) || !(mileValue > 0)) return '';
  return (rateValue / mileValue).toFixed(2);
}

function isTeamLoad(load) {
  return String(load?.team || '').trim().toLowerCase() === 'true' || isTeamEquipment(load?.eCode);
}

// Team vans (VM/VT) are shown as a plain V; the Team flag carries the team part.
function getDisplayEquipmentCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (code === 'VE') return 'VAN';
  return isTeamEquipment(code) ? 'V' : value;
}

function getLandstarEquipmentCode(value) {
  const code = String(value || '').trim().toUpperCase();
  const equipmentCodes = {
    VZ: 'VAN',
    VAN: 'VAN',
    V: 'VAN',
    VT: 'VAN',
    VM: 'VAN',
    VE: 'VAN',
    VR: 'VAN',
    R: 'REFR',
    RZ: 'REFR',
    F: 'FLAT',
    SD: 'STEP'
  };
  if (equipmentCodes[code]) return equipmentCodes[code];
  if (code.startsWith('D-LG')) return 'D-LG';
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
const ntgCustomerName = 'Nolan 965974 - ATZ H';

function normalizeCustomerName(name) {
  const normalized = String(name || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized === 'RXO2429200ATZP') {
    return rxoPayerCustomerName;
  }
  if (['NOLAN965974ATZH', 'NTG965974ATZH'].includes(normalized)) {
    return ntgCustomerName;
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

function isParaCustomer(name) {
  return normalizeCustomerName(name).toUpperCase().replace(/[^A-Z0-9]/g, '') === 'PARA1522166ATZ';
}

function isCh593772Customer(name) {
  return normalizeCustomerName(name).toUpperCase().replace(/[^A-Z0-9]/g, '') === 'CH593772ATZ';
}

const importStatusPreservationCustomers = new Set([
  'PARA1522166ATZ',
  'RXO2429200ATZP',
  'NOLAN965974ATZH'
]);

function preservesImportedLoadStatus(name) {
  const normalized = normalizeCustomerName(name).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return importStatusPreservationCustomers.has(normalized);
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

// ==========================================
// DAT RATECAST API AUTO-FETCH HELPER
// ==========================================
async function fetchDatRateForImport(order, selectedBroker, laneRates) {
  // 1. Check local saved rates first
  const savedLaneRate = getSavedLaneRate(laneRates, selectedBroker, order);
  if (savedLaneRate) {
    return { rateInput: savedLaneRate, rateSource: 'user-entered' };
  }

  // 2. Fetch live rate automatically via backend DAT Ratecast API
  try {
    const response = await fetch('/api/dat-rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: { city: order.origCity, state: order.origSt, zip: order.origZip },
        destination: { city: order.destCity, state: order.destSt, zip: order.destZip },
        equipment: order.eCode
      })
    });
    
    const data = await response.json();
    if (data && data.rate) {
      return { rateInput: String(data.rate), rateSource: 'dat-api' };
    }
  } catch (error) {
    console.error(`Could not auto-fetch DAT rate for order ${order.id}:`, error);
  }

  return { rateInput: '', rateSource: undefined };
}

function normalizeLoadId(value) {
  const text = String(value || '').trim().replace(/-ALT[A-Z]+$/i, '');
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

// Earliest pickup first; loads without a readable pickup date go last.
function getPickupSortValue(order) {
  const text = String(order.pickupTime || order.puDate || '');
  const us = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b(?:\s+(\d{2})(\d{2}))?/);
  if (us) {
    const year = us[3].length === 2 ? Number(`20${us[3]}`) : Number(us[3]);
    return Date.UTC(year, Number(us[1]) - 1, Number(us[2]), Number(us[4] || 0), Number(us[5] || 0));
  }
  const iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  return iso ? Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : Number.MAX_SAFE_INTEGER;
}

function removeDuplicateLoadImports(loads) {
  const seenLoadSchedules = new Set();
  let duplicateCount = 0;
  const uniqueLoads = loads.filter(load => {
    const loadId = normalizeLoadId(load.sourceLoadId || load.id);
    const scheduleKey = createLaneScheduleKey(load);
    if (!loadId || !scheduleKey) return true;
    const key = JSON.stringify([loadId, scheduleKey]);
    if (seenLoadSchedules.has(key)) {
      duplicateCount += 1;
      return false;
    }
    seenLoadSchedules.add(key);
    return true;
  });
  return { loads: uniqueLoads, duplicateCount };
}

function countPreviouslyExportedLoads(loads, records, { idOnly = false } = {}) {
  const ids = new Set(records.ids || []);
  const laneDays = new Set(records.laneDays || []);
  let exportedCount = 0;
  const exportedLoadIds = new Set();
  loads.forEach(load => {
    const key = createLaneDayKey(load);
    const worked = (ids.has(normalizeLoadId(load.id)) && (!key || laneDays.has(key)))
      || (!idOnly && Boolean(key) && laneDays.has(key));
    if (worked) {
      exportedCount += 1;
      exportedLoadIds.add(normalizeLoadId(load.id));
    }
  });
  return { exportedCount, exportedLoadIds };
}

function keepPreviouslyExportedLoadsOpen(loads, exportedLoadIds, customer) {
  return loads.map(load => exportedLoadIds.has(normalizeLoadId(load.id))
    ? { ...load, status: 'OPEN', tag: 'OPEN' }
    : load);
}

function getReimportedLoadStatus(existingLoad, wasPreviouslyExported) {
  return { status: 'OPEN', tag: 'OPEN' };
}

function getImportedLoadKey(load) {
  const baseId = getBaseLoadId(load);
  const key = normalizeLoadId(baseId);
  if (!key || /^(?:IMG|IMP|NTG|DAT)-\d+-\d+$/i.test(baseId)) {
    throw new Error('An imported load has no readable load number. Use a list with load numbers. Existing loads were not deleted.');
  }
  return key;
}

function deduplicateDatImports(importedLoads, existingLoads) {
  const existingByLaneDay = new Map(existingLoads.map(load => [createLaneDayKey(load), load]).filter(([key]) => key));
  const seenLaneDays = new Set();
  const unreadableRows = [];
  let skippedDuplicateCount = 0;
  const loads = importedLoads.flatMap((load, index) => {
    const key = createLaneDayKey(load);
    if (!key) {
      unreadableRows.push(`Row ${index + 1}: ${load.route || `${load.origCity || '?'} → ${load.destCity || '?'}`} (pickup: ${load.pickupTime || load.puDate || 'unreadable'})`);
      return [];
    }
    if (seenLaneDays.has(key)) {
      skippedDuplicateCount += 1;
      return [];
    }
    seenLaneDays.add(key);
    const existing = existingByLaneDay.get(key);
    if (existing) {
      return [{ ...load, id: existing.id, sourceLoadId: existing.sourceLoadId || existing.id }];
    }
    return [load];
  });
  if (unreadableRows.length === importedLoads.length && unreadableRows.length) {
    throw new Error(`No DAT rows had a readable lane and pickup date. Existing loads were not changed.\n${unreadableRows.join('\n')}`);
  }
  return { loads, skippedDuplicateCount, unreadableRows };
}

function replaceImportedCustomerLoads(customer, importedLoads, existingLoads, {
  additive = !preservesImportedLoadStatus(customer), allowGeneratedIds = additive, now = Date.now()
} = {}) {
  if (!importedLoads.length) {
    throw new Error('The imported load list is empty. Existing loads were not deleted.');
  }
  const loadKey = load => normalizeLoadId(getBaseLoadId(load));
  const importedById = new Map();
  let duplicateCount = 0;
  importedLoads.forEach(load => {
    const id = allowGeneratedIds ? getBaseLoadId(load) : getImportedLoadKey(load);
    if (!id) throw new Error('An imported load has no readable load number. Existing loads were not deleted.');
    const key = JSON.stringify([id, createLaneDayKey(load)]);
    if (importedById.has(key)) {
      duplicateCount += 1;
      return;
    }
    importedById.set(key, { ...load, id, sourceLoadId: id });
  });
  const importedLaneDays = new Set();
  const matchedIds = new Set();
  const mergedLoads = [];
  let laneDayDuplicateCount = 0;
  for (const load of importedById.values()) {
    const laneDay = createLaneDayKey(load);
    if (laneDay && importedLaneDays.has(laneDay)) {
      laneDayDuplicateCount += 1;
      continue;
    }
    if (laneDay) importedLaneDays.add(laneDay);
    const existing = existingLoads.find(order => loadKey(order) === loadKey(load) && !isNewDayForExistingLoad(order, load))
      || (allowGeneratedIds && existingLoads.find(order => laneDay && createLaneDayKey(order) === laneDay))
      || existingLoads.find(order => loadKey(order) === loadKey(load));
    const populatedFields = Object.fromEntries(Object.entries(load).filter(([, value]) =>
      value !== undefined && value !== null && String(value).trim() !== ''
    ));
    const merged = { ...existing, ...populatedFields, status: 'OPEN', tag: 'OPEN' };
    if (existing) {
      ['rateInput', 'rateSource', 'carrier', 'driver', 'driverPhone', 'truck', 'trailer', 'pickupEta', 'notes'].forEach(field => {
        if (String(existing[field] || '').trim()) merged[field] = existing[field];
      });
      if (allowGeneratedIds && load.rateSource === 'dat-screenshot' && existing.rateSource !== 'user-entered'
        && Number(load.rateInput) > 0) {
        merged.rateInput = load.rateInput;
        merged.rateSource = load.rateSource;
      }
      if (!isNewDayForExistingLoad(existing, load)) {
        merged.id = existing.id;
        merged.sourceLoadId = existing.sourceLoadId || getBaseLoadId(existing);
        matchedIds.add(String(existing.id));
      }
    }
    const fixedLaneRate = getFixedLaneRate(customer, merged);
    if (fixedLaneRate && (!existing || existing.rateSource !== 'user-entered')) {
      merged.rateInput = fixedLaneRate;
      merged.rateSource = 'user-entered';
    }
    delete merged.landstarExportedAt;
    if (isParaCustomer(customer) && load.screenshotStatus === 'ON HOLD') {
      merged.status = 'ON HOLD';
      merged.tag = 'HOLD';
    }
    delete merged.screenshotStatus;
    const reservedLoads = existingLoads.filter(order => additive || (order.status === 'ENT'
      && Number.isFinite(Date.parse(order.landstarExportedAt))
      && now - Date.parse(order.landstarExportedAt) < exportedLoadRetentionMs));
    mergedLoads.push(assignImportedLoadIdentity(merged, reservedLoads, mergedLoads));
  }
  const retained = existingLoads.filter(load => {
    if (matchedIds.has(String(load.id))) return false;
    if (importedLaneDays.has(createLaneDayKey(load))) return false;
    const exportedAt = Date.parse(load.landstarExportedAt);
    const retainedArchive = load.status === 'ENT' && Number.isFinite(exportedAt)
      && now - exportedAt < exportedLoadRetentionMs;
    return retainedArchive || (additive && !(load.status === 'ENT' && Number.isFinite(exportedAt)
      && now - exportedAt >= exportedLoadRetentionMs));
  });
  const loads = [...mergedLoads, ...retained];
  return {
    loads, additive, processedLoads: mergedLoads,
    laneDayDuplicateCount,
    usesScreenshotStatus: isParaCustomer(customer)
      && importedLoads.some(load => ['ON HOLD', 'OPEN'].includes(load.screenshotStatus)),
    duplicateCount,
    removedCount: existingLoads.filter(load => !matchedIds.has(String(load.id)) && !retained.includes(load)).length
  };
}

function getImportReplacementMessage(replacement) {
  return replacement
    ? `• ${replacement.additive ? 'Imported list merged' : 'Full list replaced'}; removed loads: ${replacement.removedCount}. Exported ENT loads retained for 30 days unless re-imported.\n` +
      `• Duplicate load/day rows skipped: ${replacement.duplicateCount}; ${replacement.usesScreenshotStatus ? 'Para screenshot: red = ON HOLD, non-red = OPEN' : 'imported loads set to OPEN'}.\n`
      + (replacement.laneDayDuplicateCount ? `• Same-lane/pickup-day duplicates skipped: ${replacement.laneDayDuplicateCount} (first load kept).\n` : '')
    : '';
}

function isNewDayForExistingLoad(existingLoad, importedLoad) {
  const existingKey = createLaneDayKey(existingLoad);
  const importedKey = createLaneDayKey(importedLoad);
  return Boolean(existingKey && importedKey && existingKey !== importedKey);
}

function normalizeScheduleValue(value) {
  const text = String(value || '').trim().toUpperCase();
  if (!text) return '';

  const usDate = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  const isoDate = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  const date = usDate
    ? `${usDate[3].length === 2 ? `20${usDate[3]}` : usDate[3]}-${usDate[1].padStart(2, '0')}-${usDate[2].padStart(2, '0')}`
    : isoDate
      ? `${isoDate[1]}-${isoDate[2].padStart(2, '0')}-${isoDate[3].padStart(2, '0')}`
      : '';
  const timeText = text
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, ' ')
    .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, ' ');
  const times = Array.from(timeText.matchAll(/\b(\d{1,2}):?(\d{2})\s*(AM|PM)?\b/g))
    .map(([, hourText, minuteText, meridiem]) => {
      let hour = Number(hourText);
      const minute = Number(minuteText);
      if (meridiem) hour = hour % 12 + (meridiem === 'PM' ? 12 : 0);
      return hour <= 23 && minute <= 59
        ? `${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`
        : '';
    })
    .filter(Boolean);

  return JSON.stringify([date, times.length ? times : timeText.replace(/\s+/g, ' ').trim()]);
}

function createLaneScheduleKey(order) {
  const laneDayKey = createLaneDayKey(order);
  if (!laneDayKey) return '';
  return JSON.stringify([
    laneDayKey,
    normalizeScheduleValue(order.pickupTime || order.puDate),
    normalizeScheduleValue(order.deliveryTime || order.delDate)
  ]);
}

function markDifferentScheduleLoadsEnt(loads, existingLoads = [], customer) {
  return loads.map(load => ({ ...load, status: 'OPEN', tag: 'OPEN' }));
}

function toAlphabeticalSuffix(index) {
  let value = Number(index);
  let suffix = '';
  while (value >= 0) {
    suffix = String.fromCharCode(65 + (value % 26)) + suffix;
    value = Math.floor(value / 26) - 1;
  }
  return suffix;
}

function getBaseLoadId(order) {
  return String(order?.sourceLoadId || order?.id || '').trim().replace(/-ALT[A-Z]+$/i, '');
}

function assignImportedLoadIdentity(importedLoad, existingLoads, stagedLoads) {
  const fallbackId = String(importedLoad?.id || '').trim();
  const baseId = getBaseLoadId(importedLoad) || fallbackId;
  if (!baseId) return importedLoad;

  const normalizedLoad = {
    ...importedLoad,
    sourceLoadId: baseId
  };
  const relatedLoads = [...existingLoads, ...stagedLoads].filter(load => getBaseLoadId(load) === baseId);
  const sameLaneDayLoad = relatedLoads.find(load => !isNewDayForExistingLoad(load, normalizedLoad));
  if (sameLaneDayLoad) {
    return { ...normalizedLoad, id: String(sameLaneDayLoad.id) };
  }

  const usedIds = new Set([...existingLoads, ...stagedLoads].map(load => String(load.id)));
  if (!usedIds.has(baseId)) return { ...normalizedLoad, id: baseId };

  let variantIndex = 0;
  let variantId = `${baseId}-ALT${toAlphabeticalSuffix(variantIndex)}`;
  while (usedIds.has(variantId)) {
    variantIndex += 1;
    variantId = `${baseId}-ALT${toAlphabeticalSuffix(variantIndex)}`;
  }
  return { ...normalizedLoad, id: variantId };
}

// Fixed lane-rate overrides: these lanes always pay the listed amount.
const fixedLaneRates = [
  { origSt: 'ID', destSt: 'FL', rate: '11000' }
];

function getFixedLaneRate(customer, order) {
  const text = value => String(value || '').trim().toUpperCase();
  const match = fixedLaneRates.find(lane =>
    (!lane.customer || normalizeCustomerName(lane.customer) === normalizeCustomerName(customer))
    && (!lane.origSt || text(order.origSt) === lane.origSt)
    && (!lane.destSt || text(order.destSt) === lane.destSt)
    && (!lane.origCity || text(order.origCity) === lane.origCity)
    && (!lane.destCity || text(order.destCity) === lane.destCity));
  return match ? match.rate : '';
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
    '',
    destination,
    normalize(order.destSt),
    '',
    normalize(order.eCode)
  ]);
}

function getSavedLaneRate(laneRates, customer, order) {
  const fixedRate = getFixedLaneRate(customer, order);
  if (fixedRate) return fixedRate;
  const key = createLaneRateKey(customer, order);
  if (!key) return '';
  if (laneRates[key]) return laneRates[key];
  // Older saved keys include ZIPs. Keep that history usable without rewriting it.
  for (const [savedKey, rate] of Object.entries(laneRates).reverse()) {
    let parts;
    try {
      parts = JSON.parse(savedKey);
    } catch (error) {
      console.error('Could not read a saved lane-rate key:', savedKey, error);
      continue;
    }
    if (!Array.isArray(parts) || parts.length !== 8) continue;
    const legacyOrder = {
      origCity: parts[1], origSt: parts[2], destCity: parts[4], destSt: parts[5], eCode: parts[7]
    };
    if (createLaneRateKey(parts[0], legacyOrder) === key && rate) return rate;
  }
  return '';
}

function normalizeBrokerList(value) {
  const brokerList = Array.isArray(value) ? value : ['Para 1522166 - ATZ', rxoCustomerName];
  const normalizedBrokers = Array.from(new Set(brokerList.map(normalizeCustomerName).filter(Boolean)));
  if (normalizedBrokers.some(isRxoCustomer)) {
    [rxoCustomerName, rxoPayerCustomerName].forEach(name => {
      if (!normalizedBrokers.includes(name)) normalizedBrokers.push(name);
    });
  }
  if (!normalizedBrokers.includes(ntgCustomerName)) normalizedBrokers.push(ntgCustomerName);
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
      // Visibility group and the default posting code come from each user's My Settings
      // at export time, so shared loads never carry one teammate's codes to another.
      const { visibilityGroup, ...rest } = load;
      const normalizedLoad = { brokerable: 'false', ...rest };
      const postingCode = String(normalizedLoad.postingCode || '').trim().toUpperCase();
      if (!postingCode || postingCode === 'ANQ') delete normalizedLoad.postingCode;
      merged.set(load.id, normalizedLoad);
    });
    normalized[normalizedName] = Array.from(merged.values());
  });
  return normalized;
}

const horizontalFlag = (...colors) => `linear-gradient(to bottom, ${colors.map((color, index) => `${color} ${(index * 100) / colors.length}% ${((index + 1) * 100) / colors.length}%`).join(', ')})`;
const verticalFlag = (...colors) => horizontalFlag(...colors).replace('to bottom', 'to right');

// Simplified flags (no emblems) drawn with CSS, since Windows does not show emoji flags.
const countryFlags = {
  CO: { name: 'Colombia', background: 'linear-gradient(to bottom, #fcd116 0% 50%, #003893 50% 75%, #ce1126 75% 100%)' },
  US: { name: 'United States', background: 'linear-gradient(#3c3b6e, #3c3b6e) 0 0 / 40% 54% no-repeat, repeating-linear-gradient(to bottom, #b22234 0 7.69%, #fff 7.69% 15.38%)' },
  MX: { name: 'Mexico', background: verticalFlag('#006847', '#fff', '#ce1126') },
  VE: { name: 'Venezuela', background: horizontalFlag('#ffcc00', '#00247d', '#cf142b') },
  EC: { name: 'Ecuador', background: 'linear-gradient(to bottom, #ffdd00 0% 50%, #034ea2 50% 75%, #ed1c24 75% 100%)' },
  PE: { name: 'Peru', background: verticalFlag('#d91023', '#fff', '#d91023') },
  AR: { name: 'Argentina', background: horizontalFlag('#74acdf', '#fff', '#74acdf') },
  GT: { name: 'Guatemala', background: verticalFlag('#4997d0', '#fff', '#4997d0') },
  HN: { name: 'Honduras', background: horizontalFlag('#0073cf', '#fff', '#0073cf') },
  SV: { name: 'El Salvador', background: horizontalFlag('#0047ab', '#fff', '#0047ab') },
  NI: { name: 'Nicaragua', background: horizontalFlag('#0067c6', '#fff', '#0067c6') },
  CU: { name: 'Cuba', background: 'linear-gradient(to bottom right, #cf142b 0 25%, transparent 25%) 0 0 / 80% 100% no-repeat, repeating-linear-gradient(to bottom, #002a8f 0 20%, #fff 20% 40%)' },
  HT: { name: 'Haiti', background: horizontalFlag('#00209f', '#d21034') },
  PR: { name: 'Puerto Rico', background: 'linear-gradient(to bottom right, #0050f0 0 25%, transparent 25%) 0 0 / 80% 100% no-repeat, repeating-linear-gradient(to bottom, #ed0000 0 20%, #fff 20% 40%)' },
  UA: { name: 'Ukraine', background: horizontalFlag('#0057b7', '#ffd700') },
  PL: { name: 'Poland', background: horizontalFlag('#fff', '#dc143c') },
  RU: { name: 'Russia', background: horizontalFlag('#fff', '#0039a6', '#d52b1e') },
  IN: { name: 'India', background: horizontalFlag('#ff9933', '#fff', '#138808') },
  NG: { name: 'Nigeria', background: verticalFlag('#008751', '#fff', '#008751') },
  IT: { name: 'Italy', background: verticalFlag('#009246', '#fff', '#ce2b37') },
  FR: { name: 'France', background: verticalFlag('#0055a4', '#fff', '#ef4135') },
  DE: { name: 'Germany', background: horizontalFlag('#000', '#dd0000', '#ffce00') }
};

const emptyProfile = { phone: '', postingCode: '', visibilityGroup: '', flag: 'CO' };

function getUserProfile() {
  if (typeof localStorage === 'undefined') return { ...emptyProfile };
  try {
    const saved = JSON.parse(localStorage.getItem('landstar_profile'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { ...emptyProfile };
    return {
      phone: String(saved.phone || ''),
      postingCode: String(saved.postingCode || ''),
      visibilityGroup: String(saved.visibilityGroup || ''),
      flag: saved.flag === 'NONE' || countryFlags[saved.flag] ? saved.flag : 'CO'
    };
  } catch (error) {
    console.error('Could not load My Settings:', error);
    return { ...emptyProfile };
  }
}

function formatPhone(digits) {
  const value = String(digits || '').replace(/\D/g, '');
  return value.length === 10 ? `${value.slice(0, 3)}-${value.slice(3, 6)}-${value.slice(6)}` : value;
}

const defaultCustomerDatasets = {
  'Para 1522166 - ATZ': [
    { id: '2274611', visibilityGroup: 'ANQ', eCode: 'VZ', status: 'ENT', tag: 'ENT', route: 'NORFOLK, VA → CHARLOTTE, NC', puDate: 'PU: 10/15 0500', delDate: 'DFL: 10/16 0900', pickupTime: '10/15/2026 0500 - 1500', origCity: 'NORFOLK', origSt: 'VA', origZip: '23502', weight: '42,852 lbs', deliveryTime: '10/16/2026 0000 - 1500', destCity: 'CHARLOTTE', destSt: 'NC', destZip: '29217', miles: '327', planningComment: 'Standard Dry Van Load', carrier: '', driver: '', truck: '', trailer: '', rateInput: '', brokerable: 'false', notes: '' }
  ],
  [rxoCustomerName]: [
    { id: '24424438', visibilityGroup: 'RXO', eCode: 'VAN:VAN', status: 'OPEN', tag: 'OPEN', route: 'BOLINGBROOK, IL → SCOTTSVILLE, KY', puDate: 'PU: Today', delDate: 'DFL: Upcoming', pickupTime: '10/18/2026 0800 - 1200', origCity: 'BOLINGBROOK', origSt: 'IL', origZip: '60440', weight: '20000 lbs', deliveryTime: '10/20/2026 0800 - 1700', destCity: 'SCOTTSVILLE', destSt: 'KY', destZip: '42164', miles: '431', planningComment: 'Imported from Excel', carrier: '', driver: '', truck: '', trailer: '', rateInput: '', brokerable: 'false', notes: '' }
  ]
};

function getLoadSearchEntries(customerOrdersMap, selectedBroker, searchQuery) {
  const query = searchQuery.trim().toLowerCase();
  const customers = query ? Object.entries(customerOrdersMap) : [[selectedBroker, customerOrdersMap[selectedBroker] || []]];
  return customers.flatMap(([customer, loads]) => loads
    .filter(order => !query || [
      order.id, order.route, order.origCity, order.origSt,
      order.destCity, order.destSt, order.planningComment
    ].some(value => String(value || '').toLowerCase().includes(query)))
    .map(order => ({ customer, order })));
}

export default function App({ sharing = null } = {}) {
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
  const [profile, setProfile] = useState(getUserProfile);
  const [profileDraft, setProfileDraft] = useState(null);
  const [sharedCustomers, setSharedCustomers] = useState(() => sharing?.getSharedCustomers() || {});
  const [shareCustomerName, setShareCustomerName] = useState(null);
  const [teammates, setTeammates] = useState([]);
  const [shareSelection, setShareSelection] = useState([]);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState('');

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
    if (!supabase) return undefined;
    let cancelled = false;
    let applying = false;
    let applyAgain = false;
    const applyEmailLoads = async () => {
      if (applying) {
        applyAgain = true;
        return;
      }
      applying = true;
      try {
        const rows = [];
        let lastId = null;
        while (!cancelled) {
          let query = supabase.from('email_loads').select('id, customer, load')
            .eq('status', 'pending').order('id').limit(100);
          if (lastId !== null) query = query.gt('id', lastId);
          const { data, error } = await query;
          if (error) throw error;
          rows.push(...(data || []));
          if (!data || data.length < 100) break;
          lastId = data[data.length - 1].id;
        }
        if (cancelled || !rows.length) return;
        const latestRates = JSON.parse(localStorage.getItem('landstar_laneRates') || '{}');
        rows.forEach(row => {
          if (!row.load?.id) return;
          const savedRate = getSavedLaneRate(latestRates, row.customer, row.load);
          if (savedRate && !(Number(row.load.rateInput) > 0)) {
            row.load = { ...row.load, rateInput: savedRate, rateSource: 'user-entered' };
          }
        });
        const fullLists = new Map();
        rows.forEach(row => {
          const customer = normalizeCustomerName(row.customer);
          if (!customer || !row.load?.id) return;
          getImportedLoadKey(row.load);
          const loads = fullLists.get(customer) || [];
          loads.push(row.load);
          fullLists.set(customer, loads);
        });
        setCustomerOrdersMap(current => {
          const next = { ...current };
          fullLists.forEach((loads, customer) => {
            next[customer] = replaceImportedCustomerLoads(customer, loads, current[customer] || []).loads;
          });
          return next;
        });
        const validIds = rows.filter(row => normalizeCustomerName(row.customer) && row.load?.id).map(row => row.id);
        if (validIds.length) {
          const { error } = await supabase.from('email_loads').update({ status: 'applied' }).in('id', validIds);
          if (error) throw error;
        }
      } catch (error) {
        console.error('Automatic email load import failed:', error);
        if (!cancelled) setStorageError(`Automatic email import failed: ${error.message || 'Could not update the load list.'}`);
      } finally {
        applying = false;
        if (applyAgain && !cancelled) {
          applyAgain = false;
          applyEmailLoads();
        }
      }
    };
    applyEmailLoads();
    const channel = supabase.channel('email-loads-apply')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'email_loads' }, applyEmailLoads)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

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
    if (field === 'eCode' && isTeamEquipment(selectedOrder.eCode)) {
      updatedOrder.team = 'true';
    }
    if (field === 'rateInput') {
      if (String(value).trim()) {
        updatedOrder.rateSource = 'user-entered';
      } else {
        delete updatedOrder.rateSource;
      }
      const laneRateKey = createLaneRateKey(selectedBroker, updatedOrder);
      const numericRate = Number(String(value).replace(/[$,]/g, ''));
      if (laneRateKey && numericRate > 0 && Number.isFinite(numericRate)) {
        const nextLaneRates = { ...laneRates, [laneRateKey]: String(numericRate) };
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
      const savedRate = getSavedLaneRate(laneRates, selectedBroker, updatedOrder);
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

  // Picks up changes saved from another browser or by teammates on shared customers
  // without resetting the customer and load being worked on.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const reloadSavedData = () => {
      let nextBrokers;
      let nextOrders;
      let nextRates;
      let nextRegistry;
      try {
        nextBrokers = normalizeBrokerList(JSON.parse(localStorage.getItem('landstar_brokers')));
        nextOrders = removeExpiredExportedLoads(
          normalizeCustomerOrders(JSON.parse(localStorage.getItem('landstar_customerOrdersMap')))
        );
        const savedRates = JSON.parse(localStorage.getItem('landstar_laneRates'));
        nextRates = savedRates && typeof savedRates === 'object' && !Array.isArray(savedRates) ? savedRates : {};
        const savedRegistry = JSON.parse(localStorage.getItem('landstar_exportedLoads'));
        nextRegistry = savedRegistry && typeof savedRegistry === 'object' && !Array.isArray(savedRegistry) ? savedRegistry : {};
      } catch (error) {
        console.error('Could not load the latest saved data:', error);
        return;
      }
      const nextSelected = nextBrokers.includes(selectedBroker) ? selectedBroker : nextBrokers[0];
      setBrokers(nextBrokers);
      setCustomerOrdersMap(nextOrders);
      setLaneRates(nextRates);
      setExportedLoadRegistry(nextRegistry);
      setProfile(getUserProfile());
      setSelectedBroker(nextSelected);
      setSelectedOrder(current => {
        const loads = nextOrders[nextSelected] || [];
        return (current && loads.find(load => String(load.id) === String(current.id))) || loads[0] || null;
      });
    };
    window.addEventListener('landstar-data-changed', reloadSavedData);
    return () => window.removeEventListener('landstar-data-changed', reloadSavedData);
  }, [selectedBroker]);

  useEffect(() => (sharing ? sharing.onSharedCustomersChange(setSharedCustomers) : undefined), [sharing]);

  const openProfileSettings = () => setProfileDraft({ ...profile, phone: formatPhone(profile.phone) });

  const handleSaveProfile = (e) => {
    e.preventDefault();
    const nextProfile = {
      phone: profileDraft.phone.replace(/\D/g, ''),
      postingCode: profileDraft.postingCode.trim().toUpperCase(),
      visibilityGroup: profileDraft.visibilityGroup.trim().toUpperCase(),
      flag: profileDraft.flag
    };
    if (nextProfile.phone.length !== 10) {
      alert('Enter a 10-digit phone number.');
      return;
    }
    if (!nextProfile.postingCode || !nextProfile.visibilityGroup) {
      alert('Enter your posting code and visibility group.');
      return;
    }
    try {
      localStorage.setItem('landstar_profile', JSON.stringify(nextProfile));
    } catch (error) {
      console.error('Could not save My Settings:', error);
      alert('Could not save My Settings. Check available browser storage and try again.');
      return;
    }
    setProfile(nextProfile);
    setProfileDraft(null);
  };

  const openShareDialog = async (customer) => {
    setShareCustomerName(customer);
    setShareSelection([]);
    setShareMessage('Loading teammates…');
    try {
      setTeammates(await sharing.listTeammates());
      setShareMessage('');
    } catch (error) {
      console.error('Could not load teammates:', error);
      setShareMessage(error.message || 'Could not load teammates.');
    }
  };

  const runShareAction = async (action, successMessage) => {
    setShareBusy(true);
    setShareMessage('');
    try {
      await action();
      setShareSelection([]);
      setShareMessage(successMessage);
      return true;
    } catch (error) {
      console.error('Customer sharing failed:', error);
      setShareMessage(error.message || 'Something went wrong. Try again.');
      return false;
    } finally {
      setShareBusy(false);
    }
  };

  const teammateEmail = (userId) => teammates.find(person => person.id === userId)?.email || 'a teammate';

  const toggleShareSelection = (userId) => {
    setShareSelection(current => current.includes(userId)
      ? current.filter(id => id !== userId)
      : [...current, userId]);
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
    if (sharedCustomers[oldName]) {
      alert('This customer is shared, so its name cannot be changed. Use 🤝 Share to stop sharing first.');
      return;
    }
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
    if (sharedCustomers[brokerToDelete]) {
      alert(sharedCustomers[brokerToDelete].isOwner
        ? 'This customer is shared. Use 🤝 Share → Stop sharing before deleting it.'
        : 'This customer is shared with you. Use 🤝 Share → Leave to remove it from your list.');
      return;
    }
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

      const payerLoads = applyRxoPayerBusinessHours(parsedLoads, selectedBroker);
      const latestRegistry = getLatestExportedRegistry();
      const exportedRecords = getExportedRecordsForCustomer(latestRegistry, selectedBroker);
      const { exportedCount, exportedLoadIds } = countPreviouslyExportedLoads(payerLoads, exportedRecords);
      const { loads: deduplicatedLoads, duplicateCount } = isRxoCustomer(selectedBroker)
        ? removeDuplicateLoadImports(payerLoads)
        : { loads: payerLoads, duplicateCount: 0 };
      const existingOrders = customerOrdersMap[selectedBroker] || [];
      const uniqueLoads = keepPreviouslyExportedLoadsOpen(
        markDifferentScheduleLoadsEnt(deduplicatedLoads, existingOrders, selectedBroker),
        exportedLoadIds,
        selectedBroker
      );
      if (!uniqueLoads.length) {
        alert(`Found ${parsedLoads.length} loads, but they were all duplicates.`);
        return;
      }

      // Auto-fetch DAT rates for Gmail imported loads if missing
      for (const load of uniqueLoads) {
        if (!Number(load.rateInput) > 0) {
          const datRateInfo = await fetchDatRateForImport(load, selectedBroker, laneRates);
          if (datRateInfo.rateInput) {
            load.rateInput = datRateInfo.rateInput;
            load.rateSource = datRateInfo.rateSource;
          }
        }
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

      const resolvedLoads = [];
      uniqueLoads.forEach(load => {
        resolvedLoads.push(assignImportedLoadIdentity(load, existingOrders, resolvedLoads));
      });
      const merged = new Map(existingOrders.map(load => [String(load.id), load]));
      resolvedLoads.forEach(load => {
        const existingLoad = merged.get(String(load.id));
        const keepsEnt = existingLoad && existingLoad.status === 'ENT' && !isNewDayForExistingLoad(existingLoad, load);
        const wasPreviouslyExported = exportedLoadIds.has(normalizeLoadId(load.id));
        const preserveStatus = preservesImportedLoadStatus(selectedBroker);
        merged.set(String(load.id), existingLoad
          ? {
            ...existingLoad,
            ...load,
            ...(preserveStatus
              ? getReimportedLoadStatus(existingLoad, wasPreviouslyExported)
              : {}),
            ...(!preserveStatus && wasPreviouslyExported
              ? { status: 'OPEN', tag: 'OPEN' }
              : !preserveStatus && keepsEnt ? { status: 'ENT', tag: 'ENT' } : {}),
            ...(isNewDayForExistingLoad(existingLoad, load) ? { landstarExportedAt: undefined } : {}),
            miles: load.miles || existingLoad.miles,
            rateInput: existingLoad.rateInput || load.rateInput,
            rateSource: existingLoad.rateSource || load.rateSource
          }
          : load);
      });
      const mergedList = Array.from(merged.values());
      const { loads: mergedFinalLoads, duplicateCount: existingDuplicates } = isRxoCustomer(selectedBroker)
        ? removeDuplicateLoadImports(mergedList)
        : { loads: mergedList, duplicateCount: 0 };
      const replacement = replaceImportedCustomerLoads(selectedBroker, payerLoads, existingOrders);
      const finalLoads = replacement ? replacement.loads : mergedFinalLoads;
      const nextOrders = { ...customerOrdersMap, [selectedBroker]: finalLoads };
      const saved = persistAppData(brokers, nextOrders);
      setCustomerOrdersMap(nextOrders);
      setSelectedOrder(finalLoads.find(load => load.id === resolvedLoads[0].id) || finalLoads[0]);
      setSelectedIds([]);
      setFilter('OPEN');
      
      alert(
        `✉️ Gmail Import Complete for ${selectedBroker}:\n` +
        `• Recognized loads: ${parsedLoads.length}\n` +
        `• Unique loads imported: ${replacement ? finalLoads.length : uniqueLoads.length}\n` +
        `• Total in list: ${finalLoads.length}\n` +
        getImportReplacementMessage(replacement) +
        (exportedCount > 0
          ? preservesImportedLoadStatus(selectedBroker)
            ? `• Previously exported; moved to OPEN: ${exportedCount}\n`
            : `• Previously exported; kept OPEN: ${exportedCount}\n`
          : '') +
        (saved ? '• Status: Saved successfully in browser storage.' : '• Warning: Save failed, check browser storage.')
      );

      if (!saved || mileageCalculationError) alert(`${saved ? '' : 'Saving failed; keep this page open and check browser storage. '}${mileageCalculationError ? `Driving miles were not calculated and remain blank where no prior miles were saved. You can still enter miles manually. Google Routes reported: ${mileageCalculationError}` : ''}`.trim());
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
    reader.onload = async (evt) => {
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
        const isRxoPayerImport = normalizeCustomerName(selectedBroker) === rxoPayerCustomerName;
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
        let importedRows = [];
        for (let idx = 0; idx < dataRows.length; idx++) {
          const row = dataRows[idx];
          if (!row || row.length === 0) continue;

          const loadId = String(row[colA] || `IMP-${Date.now()}-${idx}`).trim();
          const origC = String(row[colG] || 'UNKNOWN').toUpperCase().trim();
          const origS = String(row[colH] || '').toUpperCase().trim();
          const origZ = String(row[colI] || '00000').trim();
          const destC = String(row[colL] || 'UNKNOWN').toUpperCase().trim();
          const destS = String(row[colM] || '').toUpperCase().trim();
          const destZ = String(row[colN] || '00000').trim();
          const weightVal = isRxoPayerImport ? '42000 lbs' : String(row[colO] || '40000 lbs').trim();
          
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
          
          const tempOrder = {
            origCity: origC, origSt: origS, origZip: origZ,
            destCity: destC, destSt: destS, destZip: destZ,
            eCode: eCodeVal
          };

          let rateVal = getSavedLaneRate(laneRates, selectedBroker, tempOrder);
          let rateSrc = rateVal ? 'user-entered' : undefined;

          // Auto-fetch via DAT Ratecast API if no local rate exists
          if (!rateVal) {
            const datRateInfo = await fetchDatRateForImport(tempOrder, selectedBroker, laneRates);
            if (datRateInfo.rateInput) {
              rateVal = datRateInfo.rateInput;
              rateSrc = datRateInfo.rateSource;
            }
          }

          importedRows.push({
            id: loadId,
            eCode: eCodeVal,
            status: 'OPEN',
            tag: 'OPEN',
            route: laneKey,
            puDate: useRxoDateTimeFormat && puTimeVal ? `PU: ${puTimeVal.split(' ')[0]}` : 'PU: Today',
            delDate: useRxoDateTimeFormat && delTimeVal ? `DFL: ${delTimeVal.split(' ')[0]}` : 'DFL: Upcoming',
            pickupTime: puTimeVal,
            origCity: origC,
            origSt: origS,
            origZip: origZ,
            weight: weightVal,
            deliveryTime: delTimeVal,
            destCity: destC,
            destSt: destS,
            destZip: destZ,
            miles: milesVal,
            planningComment: 'Imported from Excel',
            carrier: '',
            driver: '',
            truck: '',
            trailer: '',
            rateInput: rateVal,
            ...(rateSrc ? { rateSource: rateSrc } : {}),
            brokerable: 'false',
            notes: ''
          });
        }

        // Run ZIP code auto-fill on Excel import rows
        importedRows = autoFillLoadZipCodes(importedRows);
        importedRows = applyRxoPayerBusinessHours(importedRows, selectedBroker);

        const latestRegistry = getLatestExportedRegistry();
        const exportedRecords = getExportedRecordsForCustomer(latestRegistry, selectedBroker);
        const { exportedCount, exportedLoadIds } = countPreviouslyExportedLoads(importedRows, exportedRecords);
        const { loads: deduplicatedLoads, duplicateCount: duplicateImportCount } = isRxoImport
          ? removeDuplicateLoadImports(importedRows)
          : { loads: importedRows, duplicateCount: 0 };
        const existingLoads = customerOrdersMap[selectedBroker] || [];
        const importedLoads = keepPreviouslyExportedLoadsOpen(
          markDifferentScheduleLoadsEnt(deduplicatedLoads, existingLoads, selectedBroker),
          exportedLoadIds,
          selectedBroker
        );

        if (importedLoads.length === 0) {
          alert("No valid loads found in the spreadsheet rows.");
          return;
        }

        const resolvedImportedLoads = [];
        importedLoads.forEach(load => {
          resolvedImportedLoads.push(assignImportedLoadIdentity(load, existingLoads, resolvedImportedLoads));
        });
        const mergedLoads = new Map(existingLoads.map(load => [load.id, load]));
        resolvedImportedLoads.forEach(load => {
          const existingLoad = mergedLoads.get(load.id);
          const wasPreviouslyExported = exportedLoadIds.has(normalizeLoadId(load.id));
          const preserveStatus = preservesImportedLoadStatus(selectedBroker);
          if (existingLoad && preserveStatus && !isNewDayForExistingLoad(existingLoad, load)) {
            mergedLoads.set(load.id, {
              ...existingLoad,
              ...getReimportedLoadStatus(existingLoad, wasPreviouslyExported)
            });
          }
          if (!existingLoad || isNewDayForExistingLoad(existingLoad, load)) {
            mergedLoads.set(load.id, existingLoad ? { ...load, rateInput: load.rateInput || existingLoad.rateInput } : load);
          } else if (wasPreviouslyExported && !preserveStatus) {
            mergedLoads.set(load.id, { ...existingLoad, status: 'OPEN', tag: 'OPEN' });
          } else if (load.status === 'ENT' && existingLoad.status !== 'ENT' && !preserveStatus) {
            mergedLoads.set(load.id, { ...existingLoad, status: 'ENT', tag: 'ENT' });
          } else if (useRxoDateTimeFormat) {
            mergedLoads.set(load.id, {
              ...mergedLoads.get(load.id),
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
        const { loads: mergedFinalLoads, duplicateCount: duplicateExistingCount } = isRxoImport
          ? removeDuplicateLoadImports(mergedLoadList)
          : { loads: mergedLoadList, duplicateCount: 0 };
        const replacement = replaceImportedCustomerLoads(selectedBroker, importedRows, existingLoads);
        const finalLoads = replacement ? replacement.loads : mergedFinalLoads;
        const nextOrders = { ...customerOrdersMap, [selectedBroker]: finalLoads };
        const saved = persistAppData(brokers, nextOrders);
        setCustomerOrdersMap(nextOrders);
        setSelectedOrder(finalLoads.find(load => load.id === resolvedImportedLoads[0].id) || finalLoads[0]);
        setSelectedIds([]);
        setFilter('OPEN');

        const duplicatesRemoved = replacement ? 0 : duplicateImportCount + duplicateExistingCount;

        alert(
          `📂 Excel Import Complete for ${selectedBroker}:\n` +
          `• Added/Processed: ${replacement ? finalLoads.length : importedLoads.length} loads\n` +
          `• Total in list: ${finalLoads.length} loads\n` +
          getImportReplacementMessage(replacement) +
          (exportedCount > 0
            ? preservesImportedLoadStatus(selectedBroker)
              ? `• Previously exported; moved to OPEN: ${exportedCount}\n`
              : `• Previously exported; kept OPEN: ${exportedCount}\n`
            : '') +
          (duplicatesRemoved > 0 ? `• Skipped duplicates: ${duplicatesRemoved}\n` : '') +
          (saved ? '• Status: Saved successfully in browser storage.' : '• Warning: Save failed, check browser storage.')
        );

        if (!saved) alert('Saving failed; keep this page open and check browser storage.');
      } catch (err) {
        console.error(err);
        alert(`Excel import failed: ${err.message || "Please make sure it's a valid .xlsx or .xls file."}`);
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
    setScreenshotImportProgress(importMode === 'dat' ? 'Preparing DAT screenshot...' : importMode === 'ntg' ? 'Preparing NTG screenshot...' : importMode === 'ch' ? 'Preparing CH screenshot...' : 'Preparing customer screenshot...');
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
      let lines = (data.blocks || []).flatMap(block =>
        block.paragraphs.flatMap(paragraph => paragraph.lines)
      );
      const tableGrid = importMode === 'ai' ? detectScreenshotGrid(canvas) : null;
      let gridSkippedRows = [];
      if (tableGrid) {
        lines = await readScreenshotGrid(worker, canvas, tableGrid, setScreenshotImportProgress, image);
        gridSkippedRows = lines.skippedRows || [];
        if (!lines.length) {
          throw new Error(`No screenshot rows could be read. Existing loads were not deleted.\n${gridSkippedRows.join('\n')}`);
        }
      }
      const dataLines = lines
        .filter(line => line.bbox.y0 >= canvas.height * 0.035)
        .sort((a, b) => a.bbox.y0 - b.bbox.y0);
      const centers = dataLines.map(line => (line.bbox.y0 + line.bbox.y1) / 2);
      const spacings = centers.slice(1)
        .map((center, index) => center - centers[index])
        .filter(spacing => spacing > 0 && spacing < canvas.height * 0.08)
        .sort((a, b) => a - b);
      const rowSpacing = spacings[Math.floor(spacings.length / 2)];

      if (!tableGrid && rowSpacing && importMode !== 'ntg' && importMode !== 'ch') {
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

      if (importMode === 'ai' && !tableGrid) {
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
          let redPixels = 0;
          for (let offset = 0; offset < imageData.data.length; offset += 4) {
            if (imageData.data[offset] > 180 && imageData.data[offset + 1] < 100 && imageData.data[offset + 2] < 100) {
              redPixels += 1;
            }
          }
          line.orderNumberHighlighted = redPixels > cropCanvas.width * cropCanvas.height * 0.2;
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
      const isChImport = importMode === 'ch';
      let chSkipNote = '';
      if (isNtgImport) {
        const { cards: ntgCards, spacing: ntgSpacing } = findNtgCards(lines, canvas.width, canvas.height);
        const readStrip = async (x0, y0, x1, y1, pattern) => {
          const left = Math.max(0, Math.round(x0));
          const top = Math.max(0, Math.round(y0));
          const width = Math.min(canvas.width, Math.round(x1)) - left;
          const height = Math.min(canvas.height, Math.round(y1)) - top;
          if (width < 4 || height < 4) return '';
          for (const threshold of [150, 110, 190, 0]) {
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = width * 2 + 64;
            cropCanvas.height = height * 2 + 64;
            const cropContext = cropCanvas.getContext('2d', { willReadFrequently: true });
            cropContext.fillStyle = '#fff';
            cropContext.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
            cropContext.drawImage(canvas, left, top, width, height, 32, 32, width * 2, height * 2);
            if (threshold) {
              const pixels = cropContext.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
              for (let offset = 0; offset < pixels.data.length; offset += 4) {
                const luminance = pixels.data[offset] * 0.299 + pixels.data[offset + 1] * 0.587 + pixels.data[offset + 2] * 0.114;
                const value = luminance < threshold ? 0 : 255;
                pixels.data[offset] = value;
                pixels.data[offset + 1] = value;
                pixels.data[offset + 2] = value;
                pixels.data[offset + 3] = 255;
              }
              cropContext.putImageData(pixels, 0, 0);
            }
            const { data: stripData } = await worker.recognize(cropCanvas);
            const found = stripData.text.match(pattern)?.[0];
            if (found) return found;
          }
          return '';
        };
        const cardNeedsId = card => !card.words.some(word => word.x0 < 0.2 && /^\d{7}$/.test(word.text));
        const cardNeedsWeight = card => !card.words.some(word =>
          word.cx > 0.6 && /^(\d{1,3}(,\d{3})+|\d{4,6})(\.\d+)?$/.test(word.text)
        );
        if (ntgCards.some(card => cardNeedsId(card) || cardNeedsWeight(card))) {
          setScreenshotImportProgress('Reading missed load details...');
          await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789,.' });
          for (const card of ntgCards) {
            if (cardNeedsId(card)) {
              const idWordSize = card.words.find(word => /^total$/i.test(word.text))?.h || canvas.height * 0.06;
              const loadNumber = (await readStrip(
                canvas.width * 0.01, card.cy - idWordSize, canvas.width * 0.1, card.cy + idWordSize * 2.4, /\d{7}/
              )).slice(0, 7);
              if (loadNumber) {
                lines.push({
                  bbox: { x0: 0, y0: card.cy - 5, x1: canvas.width * 0.08, y1: card.cy + 5 },
                  text: loadNumber,
                  words: [{ text: loadNumber, bbox: { x0: canvas.width * 0.03, y0: card.cy - 5, x1: canvas.width * 0.08, y1: card.cy + 5 } }]
                });
              }
            }
            const totalWord = card.words.find(word => /^total$/i.test(word.text));
            if (cardNeedsWeight(card) && totalWord) {
              const weightText = await readStrip(
                canvas.width * 0.69, totalWord.cy + totalWord.h * 1.5,
                totalWord.x0 * canvas.width - 8, totalWord.cy + totalWord.h * 4.2,
                /\d{1,3}(,\d{3})+(\.\d+)?|\d{4,6}(\.\d+)?/
              );
              if (weightText) {
                const y = totalWord.cy + totalWord.h * 2.7;
                lines.push({
                  bbox: { x0: canvas.width * 0.74, y0: y - 5, x1: canvas.width * 0.8, y1: y + 5 },
                  text: weightText,
                  words: [{ text: weightText, bbox: { x0: canvas.width * 0.74, y0: y - 5, x1: canvas.width * 0.8, y1: y + 5 } }]
                });
              }
            }
          }
        }
        const cardHasHazmat = card => card.words.some(word => /^haz/i.test(word.text));
        if (ntgCards.some(card => !cardHasHazmat(card))) {
          setScreenshotImportProgress('Checking cards for Hazmat tags...');
          await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '' });
          for (const card of ntgCards) {
            if (cardHasHazmat(card)) continue;
            const tagText = await readStrip(
              canvas.width * 0.005, card.cy + ntgSpacing * 0.3, canvas.width * 0.3, card.cy + ntgSpacing * 0.78, /haz\w*/i
            );
            if (tagText) {
              const y = card.cy + ntgSpacing * 0.5;
              lines.push({
                bbox: { x0: 0, y0: y - 5, x1: canvas.width * 0.1, y1: y + 5 },
                text: 'Hazmat',
                words: [{ text: 'Hazmat', bbox: { x0: 0, y0: y - 5, x1: canvas.width * 0.1, y1: y + 5 } }]
              });
            }
          }
        }
      }
      let recognizedLoads;
      if (isChImport) {
        setScreenshotImportProgress('Reading states and rates...');
        const chResult = await readChScreenshot(worker, canvas, lines, brokerName, laneRates, scale);
        recognizedLoads = chResult.loads;
        chSkipNote = (chResult.skippedLtl ? `• Skipped LTL rows: ${chResult.skippedLtl}\n` : '')
          + (chResult.skippedNoDate ? `• Skipped rows with no date heading above them: ${chResult.skippedNoDate}\n` : '');
      } else {
        recognizedLoads = isDatImport
          ? parseDatScreenshotLines(lines, canvas.width, canvas.height, brokerName, laneRates)
          : isNtgImport
            ? parseNtgScreenshotLines(lines, canvas.width, canvas.height)
            : parseScreenshotLines(lines, canvas.width, canvas.height, brokerName);
      }
      if (tableGrid && recognizedLoads.length !== tableGrid.rows.length - gridSkippedRows.length) {
        throw new Error(`Read ${recognizedLoads.length} of ${tableGrid.rows.length - gridSkippedRows.length} screenshot load rows. Existing loads were not deleted. Use a clearer image with every origin and destination visible.`);
      }
      
      // Run ZIP Code Auto-fill on Screenshot loads
      recognizedLoads = autoFillLoadZipCodes(recognizedLoads);

      if (!isDatImport && !isNtgImport && recognizedLoads.length > 0) {
        try {
          const zipModule = await import('zipcodes');
          correctCitiesFromZip(recognizedLoads, zipModule.default || zipModule);
        } catch (error) {
          console.error('Could not use ZIP data to verify screenshot cities:', error);
        }
      }
      const applyDatCityFix = async () => {
        if (!(isDatImport || isChImport) || recognizedLoads.length === 0) return;
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
          let retryLoads = parseDatScreenshotLines(
            retryLines,
            canvas.width,
            canvas.height,
            brokerName,
            laneRates
          );
          retryLoads = autoFillLoadZipCodes(retryLoads);
          if (retryLoads.length > recognizedLoads.length) recognizedLoads = retryLoads;
          if (recognizedLoads.length > 0) break;
        }
      }

      if (isDatImport && recognizedLoads.length > 0) {
        setScreenshotImportProgress('Reading DAT rates...');
        await worker.setParameters({
          tessedit_pageseg_mode: '7',
          tessedit_char_whitelist: '0123456789,$./mi'
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
          const candidates = new Map();
          for (const [top, bottom, threshold] of variants) {
            const y0 = Math.max(0, Math.round(crop.centerY + crop.rowHeight * top));
            const y1 = Math.min(canvas.height, Math.round(crop.centerY + crop.rowHeight * bottom));
            if (y1 <= y0) continue;
            const scale = 4;
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = (crop.x1 - crop.x0) * scale + 32;
            cropCanvas.height = (y1 - y0) * scale + 32;
            const cropContext = cropCanvas.getContext('2d', { willReadFrequently: true });
            if (!cropContext) break;
            cropContext.imageSmoothingQuality = 'high';
            cropContext.fillStyle = '#fff';
            cropContext.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
            cropContext.drawImage(canvas, crop.x0, y0, crop.x1 - crop.x0, y1 - y0, 16, 16, cropCanvas.width - 32, cropCanvas.height - 32);
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
            const rateValue = parseDatRateText(rateData.text);
            if (isPlausible(rateValue)) {
              candidates.set(rateValue, (candidates.get(rateValue) || 0) + 1);
            }
          }
          const ranked = [...candidates].sort((a, b) => b[1] - a[1]);
          if (ranked[0]?.[1] >= 2 && (!ranked[1] || ranked[0][1] > ranked[1][1])) found = ranked[0][0];
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

      // DAT screenshots must retain posted rates rather than substitute market estimates.
      for (const load of recognizedLoads) {
        if (!isDatImport && !(Number(load.rateInput) > 0)) {
          const datRateInfo = await fetchDatRateForImport(load, brokerName, laneRates);
          if (datRateInfo.rateInput) {
            load.rateInput = datRateInfo.rateInput;
            load.rateSource = datRateInfo.rateSource;
          }
        }
      }

      if (recognizedLoads.length === 0) {
        throw new Error(isChImport
          ? `No CH loads were recognized.${chSkipNote ? ` Skipped rows:\n${chSkipNote}` : ' Capture the board straight-on with the Load #, Origin, OST, Destination, DST, Pickup Hours, Mode, Weight and Bin columns and a date heading visible.'}`
          : isDatImport
          ? 'No DAT load rows were recognized. Capture the DAT results table straight-on with the Origin, Destination, Pick Up, EQ, and Weight columns visible.'
          : isNtgImport
            ? 'No NTG loads were recognized. The text in the screenshot is probably too small to read: set the browser zoom to 100% (Ctrl+0), then capture about 4-5 load cards at a time with the Load #, cities, miles, weight and Total Rate visible.'
          : 'No load rows could be read. Try a clearer, straight-on screenshot that includes the full table.');
      }

      recognizedLoads = applyRxoPayerBusinessHours(recognizedLoads, brokerName);
      const existingOrders = customerOrdersMap[brokerName] || [];
      const latestRegistry = getLatestExportedRegistry();
      const exportedRecords = getExportedRecordsForCustomer(latestRegistry, brokerName);
      const { exportedCount, exportedLoadIds } = countPreviouslyExportedLoads(
        recognizedLoads,
        exportedRecords,
        { idOnly: isNtgImport || isChImport }
      );
      let importedLoads = recognizedLoads;
      let skippedDuplicateCount = 0;
      let datUnreadableRows = [];
      if (isDatImport) {
        const deduplicated = deduplicateDatImports(importedLoads, existingOrders);
        importedLoads = deduplicated.loads;
        skippedDuplicateCount = deduplicated.skippedDuplicateCount;
        datUnreadableRows = deduplicated.unreadableRows;
      }
      importedLoads = keepPreviouslyExportedLoadsOpen(
        markDifferentScheduleLoadsEnt(importedLoads, existingOrders, brokerName),
        exportedLoadIds,
        brokerName
      );

      if (importedLoads.length === 0) {
        const exportedMessage = !isDatImport && exportedCount
          ? preservesImportedLoadStatus(brokerName)
            ? ` ${exportedCount} previously exported loads moved to OPEN.`
            : ` ${exportedCount} previously exported loads remain in OPEN.`
          : '';
        alert(`Read ${recognizedLoads.length} load rows, but none were added for ${brokerName}.${exportedMessage}${skippedDuplicateCount ? ' They duplicated a lane and pickup date already imported.' : ''}${datUnreadableRows.length ? `\nSkipped unreadable rows:\n${datUnreadableRows.join('\n')}` : ''}`);
        return;
      }

      const resolvedImportedLoads = [];
      importedLoads.forEach(load => {
        resolvedImportedLoads.push(assignImportedLoadIdentity(load, existingOrders, resolvedImportedLoads));
      });

      const existingIds = new Set(existingOrders.map(order => order.id));
      let chMileageError = '';
      if (isChImport) {
        const loadsNeedingMiles = resolvedImportedLoads.filter(load => {
          if (load.status === 'ENT') return false;
          const existingMiles = existingOrders.find(order => order.id === load.id)?.miles;
          if (Number(existingMiles) > 0) {
            load.miles = existingMiles;
            return false;
          }
          return Boolean(load.origSt && load.destSt);
        });
        for (let index = 0; index < loadsNeedingMiles.length; index += 1) {
          const load = loadsNeedingMiles[index];
          setScreenshotImportProgress(`Calculating driving miles ${index + 1} of ${loadsNeedingMiles.length}...`);
          try {
            load.miles = await getGoogleRoadMiles(load);
            load.planningComment = 'Imported from CH screenshot; driving miles calculated by Google Routes';
          } catch (error) {
            console.error('Google Routes could not calculate CH screenshot miles:', error);
            chMileageError = error.message || 'Google Routes could not calculate the driving miles.';
            break;
          }
        }
      }
      const mergeableFields = [
        'pickupTime', 'origCity', 'origSt', 'origZip', 'weight',
        'deliveryTime', 'destCity', 'destSt', 'destZip', 'miles',
        'planningComment', 'rateInput', 'rateSource'
      ];
      const mergedImportedLoads = resolvedImportedLoads.map(importedLoad => {
        const existingLoad = existingOrders.find(order => order.id === importedLoad.id);
        if (!existingLoad) return importedLoad;
        const wasPreviouslyExported = exportedLoadIds.has(normalizeLoadId(importedLoad.id));
        if (isNewDayForExistingLoad(existingLoad, importedLoad)) {
          const { landstarExportedAt, ...rest } = existingLoad;
          return { ...rest, ...importedLoad, rateInput: importedLoad.rateInput || existingLoad.rateInput };
        }
        const mergedLoad = { ...importedLoad, ...existingLoad };
        if (isDatImport && importedLoad.rateSource === 'dat-screenshot'
          && existingLoad.rateSource !== 'user-entered' && Number(importedLoad.rateInput) > 0) {
          mergedLoad.rateInput = importedLoad.rateInput;
          mergedLoad.rateSource = 'dat-screenshot';
        }
        const fixedLaneRate = getFixedLaneRate(brokerName, mergedLoad);
        if (fixedLaneRate && existingLoad.rateSource !== 'user-entered') {
          mergedLoad.rateInput = fixedLaneRate;
          mergedLoad.rateSource = 'user-entered';
        }
        const preserveStatus = preservesImportedLoadStatus(brokerName);
        if (preserveStatus) {
          Object.assign(mergedLoad, getReimportedLoadStatus(existingLoad, wasPreviouslyExported));
        } else if (wasPreviouslyExported) {
          mergedLoad.status = 'OPEN';
          mergedLoad.tag = 'OPEN';
        } else if (importedLoad.status === 'ENT' && !preserveStatus) {
          mergedLoad.status = 'ENT';
          mergedLoad.tag = 'ENT';
        }
        if (!isDatImport) {
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
      const replacement = replaceImportedCustomerLoads(brokerName, isDatImport ? importedLoads : recognizedLoads, existingOrders,
        isDatImport ? { additive: true, allowGeneratedIds: true }
          : gridSkippedRows.length ? { additive: true, allowGeneratedIds: !preservesImportedLoadStatus(brokerName) } : {});
      const finalLoads = replacement ? replacement.loads : Array.from(mergedOrders.values());
      const nextOrders = {
        ...customerOrdersMap,
        [brokerName]: finalLoads
      };
      const saved = persistAppData(brokers, nextOrders);
      setCustomerOrdersMap(nextOrders);
      setSelectedOrder(replacement.processedLoads[0]);
      setSelectedIds([]);
      setFilter(replacement.usesScreenshotStatus ? 'ALL' : 'OPEN');

      const unreadableIds = isChImport ? 0 : importedLoads.filter(order => order.notes).length;
      const unreadableWeights = importedLoads.filter(order => !order.weight).length;
      const unreadablePickups = importedLoads.filter(order => !order.pickupTime).length;
      const unreadableRates = isDatImport || isChImport ? importedLoads.filter(order => !(Number(order.rateInput) > 0)).length : 0;
      const missingChStates = isChImport ? importedLoads.filter(order => !order.origSt || !order.destSt).length : 0;
      const missingChMiles = isChImport ? importedLoads.filter(order => order.status !== 'ENT' && !(Number(order.miles) > 0)).length : 0;
      const newLoadCount = replacement.processedLoads.filter(load => !existingIds.has(load.id)).length;
      const updatedLoads = replacement.processedLoads.length - newLoadCount;

      alert(
        `📸 ${isDatImport ? 'DAT' : isNtgImport ? 'NTG' : isChImport ? 'CH' : 'Customer'} Screenshot Import Complete for ${brokerName}:\n` +
        `• Recognized rows: ${recognizedLoads.length}\n` +
        `• New loads added: ${newLoadCount}\n` +
        `• Existing loads updated: ${updatedLoads}\n` +
        getImportReplacementMessage(replacement) +
        (isDatImport && skippedDuplicateCount ? `• Duplicate lane/pickup-day rows skipped: ${skippedDuplicateCount}\n` : '') +
        (datUnreadableRows.length ? `• Skipped unreadable rows (not imported):\n${datUnreadableRows.join('\n')}\n` : '') +
        (gridSkippedRows.length ? `• Skipped rows (not imported; existing loads kept). Add these by hand or widen the column and re-import:\n${gridSkippedRows.join('\n')}\n` : '') +
        (exportedCount > 0
          ? replacement?.usesScreenshotStatus
            ? `• Previously exported; status taken from screenshot color: ${exportedCount}\n`
          : preservesImportedLoadStatus(brokerName)
            ? `• Previously exported; moved to OPEN: ${exportedCount}\n`
            : `• Previously exported; kept OPEN: ${exportedCount}\n`
          : '') +
        chSkipNote +
        (unreadableWeights > 0 ? `• Missing weights: ${unreadableWeights}\n` : '') +
        (unreadablePickups > 0 ? `• Missing pickup times: ${unreadablePickups}\n` : '') +
        (isChImport && unreadableRates > 0 ? `• No rate on the board (enter manually): ${unreadableRates}\n` : '') +
        (missingChStates > 0 ? `• State not read: ${missingChStates}\n` : '') +
        (missingChMiles > 0 ? `• Driving miles missing: ${missingChMiles}${chMileageError ? ` (${chMileageError})` : ''}\n` : '') +
        (saved ? '• Status: Saved successfully.' : '• Warning: Save failed.')
      );

      const importWarnings = `${saved ? '' : ' Saving failed; keep this page open and check browser storage.'}${unreadableIds ? ` ${unreadableIds} order number${unreadableIds === 1 ? ' was' : 's were'} unreadable.` : ''}${unreadablePickups ? ` ${unreadablePickups} pickup date/time${unreadablePickups === 1 ? ' was' : 's were'} not recognized; please check those loads.` : ''}${unreadableWeights ? ` ${unreadableWeights} weight${unreadableWeights === 1 ? ' was' : 's were'} not recognized; please check those loads.` : ''}${unreadableRates ? ` ${unreadableRates} DAT rate${unreadableRates === 1 ? ' was' : 's were'} not recognized; enter them manually.` : ''}`.trim();
      if (importWarnings && !saved) alert(importWarnings);
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
    const exportPhone = profile.phone.replace(/\D/g, '');
    const exportVisibilityGroup = profile.visibilityGroup.trim().toUpperCase();
    if (exportPhone.length !== 10 || !profile.postingCode.trim() || !exportVisibilityGroup) {
      alert('Open ⚙ My Settings and enter your 10-digit phone number, posting code and visibility group before exporting.');
      openProfileSettings();
      return;
    }
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
      const extraCities = { 'HAMBERG|ND': { zip: '58145', city: 'Hamberg', state: 'ND' } };
      const extraKey = `${String(city || '').trim().toUpperCase()}|${String(state || '').trim().toUpperCase()}`;
      if (extraCities[extraKey]) return extraCities[extraKey];
      const cityName = String(city || '').trim()
        .replace(/^MT\.?\s+/i, 'Mount ').replace(/^ST\.?\s+/i, 'Saint ').replace(/^FT\.?\s+/i, 'Fort ');
      const stateCode = String(state || '').trim();
      const exactMatches = zipData.lookupByName?.(cityName, stateCode) || [];
      const prefixCounts = exactMatches.reduce((counts, location) => {
        const prefix = location.zip.slice(0, 3);
        counts[prefix] = (counts[prefix] || 0) + 1;
        return counts;
      }, {});
      const exactMatch = exactMatches.length > 1
        ? exactMatches.find(location => prefixCounts[location.zip.slice(0, 3)] > 1 && !location.zip.endsWith('00')) || exactMatches[0]
        : exactMatches[0];
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
      const originLocation = enteredOriginLocation || lookupCityState(ord.origCity, ord.origSt);
      const destinationLocation = enteredDestinationLocation || lookupCityState(ord.destCity, ord.destSt);
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
      const miles = Number(normalizeMilesValue(ord.miles));
      const weight = parseWeightPounds(ord.weight);
      const rate = Number(String(ord.rateInput || '').replace(/[$,]/g, ''));
      const postingCode = String(ord.postingCode || profile.postingCode).trim().toUpperCase();
      const visibilityCode = exportVisibilityGroup;
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
      if (pickupFrom !== null && deliveryFrom !== null && deliveryFrom <= pickupFrom) {
        rowErrors.push('delivery start must be later than pickup start');
      }
      if (!equipment) rowErrors.push('valid equipment');
      if (!['CGAPP', 'HAZMAT', 'CHEM'].includes(commodity)) rowErrors.push('valid commodity');
      if (!allowMissingMiles && !(miles > 0)) rowErrors.push('miles');
      if (weight === null || weight > 999999) {
        rowErrors.push('weight (enter whole pounds from 1 to 999,999)');
      }
      if (!(rate > 0) || !['user-entered', 'dat-screenshot', 'dat-api'].includes(ord.rateSource)) {
        rowErrors.push('rate (enter a current DAT quote or import one via DAT API/screenshot)');
      }

      if (rowErrors.length) validationErrors.push(`Order ${ord.id}: ${rowErrors.join(', ')}`);

      return {
        "Customer ID(Required)": customerIdVal,
        "Posting Call Back 10 Digits Phone Number": exportPhone,
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
        "Equipment 2": isTeamLoad(ord) ? '53VN' : String(ord.eCode || '').trim().toUpperCase() === 'D-LG,D-ST' ? 'D-ST' : '',
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
        "Team": isTeamLoad(ord) ? 'true' : 'false'
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
    if (missingZipLoads.length) {
      alert(`No ZIP code could be found for ${missingZipLoads.length} load${missingZipLoads.length === 1 ? '' : 's'}, and Landstar needs a ZIP to fill in the state. Enter the ZIP in the load's Origin or Destination ZIP field, then export again:\n\n${missingZipLoads.slice(0, 10).map(record => `${record['Origin City'] || ''} → ${record['Destination City'] || ''}`).join('\n')}`);
      return;
    }

    const exportedIds = new Set(loadsToExport.map(order => String(order.id)));
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
      [selectedBroker]: markLoadsExported(orders, exportedIds, exportedAt)
    };
    const saved = persistAppData(brokers, nextOrders);
    setExportErrorIds([]);
    setCustomerOrdersMap(nextOrders);
    setSelectedIds(prev => prev.filter(id => !exportedIds.has(String(id))));
    setSelectedOrder(
      selectedOrder && exportedIds.has(String(selectedOrder.id))
        ? nextOrders[selectedBroker].find(order => String(order.id) === String(selectedOrder.id)) || selectedOrder
        : selectedOrder || nextOrders[selectedBroker][0] || null
    );

    const exportWarnings = `${saved ? '' : 'Browser storage could not be updated, so the archive may not persist after refresh. '}${exportedRegistrySaved ? '' : 'Warning: exported-load history could not be saved, so duplicate imports may occur after refresh.'}`.trim();
    if (exportWarnings) alert(exportWarnings);
  };

  const isGlobalSearch = Boolean(searchQuery.trim());
  const visibleOrderEntries = getLoadSearchEntries(customerOrdersMap, selectedBroker, searchQuery).filter(({ order: ord }) => {
    const matchesFilter = filter === 'ALL' || ord.status === filter;
    const miles = Number(String(ord.miles || '').replace(/[^0-9.]/g, ''));
    const minimumMiles = loadFilters.minMiles === '' ? null : Number(loadFilters.minMiles);
    const maximumMiles = loadFilters.maxMiles === '' ? null : Number(loadFilters.maxMiles);
    const matchesMinimumMiles = minimumMiles === null || (Number.isFinite(miles) && miles >= minimumMiles);
    const matchesMaximumMiles = maximumMiles === null || (Number.isFinite(miles) && miles <= maximumMiles);
    return matchesFilter && matchesMinimumMiles && matchesMaximumMiles;
  }).sort(({ order: left }, { order: right }) => {
    if (laneSort === 'pickup-asc' || laneSort === 'pickup-desc') {
      const difference = getPickupSortValue(left) - getPickupSortValue(right);
      return (laneSort === 'pickup-desc' ? -difference : difference)
        || String(left.id).localeCompare(String(right.id), undefined, { numeric: true });
    }
    if (!laneSort) return 0;
    const descending = laneSort.endsWith('-desc');
    const sortKey = laneSort.replace(/-asc$|-desc$/, '');
    const isOrigin = sortKey.startsWith('origin');
    const [leftCity, leftState] = isOrigin
      ? [left.origCity, left.origSt]
      : [left.destCity, left.destSt];
    const [rightCity, rightState] = isOrigin
      ? [right.origCity, right.origSt]
      : [right.destCity, right.destSt];
    const stateFirst = sortKey.endsWith('-state');
    const leftLocation = stateFirst ? [leftState, leftCity] : [leftCity, leftState];
    const rightLocation = stateFirst ? [rightState, rightCity] : [rightCity, rightState];
    const comparison = leftLocation.map(value => String(value || '').trim()).join(', ').localeCompare(
      rightLocation.map(value => String(value || '').trim()).join(', '),
      undefined,
      { sensitivity: 'base', numeric: true }
    );
    return (descending ? -comparison : comparison) || String(left.id).localeCompare(String(right.id));
  });
  const filteredOrders = visibleOrderEntries
    .filter(({ customer }) => customer === selectedBroker)
    .map(({ order }) => order);

  const handleSelectSearchResult = (customer, order) => {
    if (customer !== selectedBroker) {
      setSelectedBroker(customer);
      setSelectedIds([]);
      setExportErrorIds([]);
    }
    setSelectedOrder(order);
  };

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
    <div className="tms-shell flex h-screen text-white overflow-hidden font-sans">
      {/* Left Sidebar - Order List */}
      <div className="tms-sidebar w-96 border-r border-[#1c2541] flex flex-col">
        <div className="tms-sidebar-header p-3 border-b border-[#1c2541]">
          <div className="tms-top-controls flex flex-col items-start gap-2 mb-2">
            <div className="tms-sidebar-logos">
              <img className="tms-logo" src="/landstar-wordmark.png" alt="Landstar" width="180" height="47" />
              <img className="tms-eagles-logo" src="/eagles-sidebar.png" alt="Eagles artwork" width="474" height="475" />
            </div>
            <div className="flex flex-wrap items-center gap-1">
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

          <div className="tms-top-controls flex items-center justify-end gap-1 mb-2">
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
                  className={`tms-customer flex items-center justify-between px-2.5 py-1.5 text-[11px] rounded font-medium border transition-colors ${selectedBroker === broker ? 'bg-blue-600/30 border-blue-500 text-white' : 'bg-[#1c2541] border-[#253259] text-gray-300 hover:bg-[#253259]'}`}
                  data-selected={selectedBroker === broker}
                >
                  <span
                    className="truncate flex-1 cursor-pointer"
                    onClick={() => handleSelectBroker(broker)}
                    title={sharedCustomers[broker] ? 'Shared customer – teammates see the same loads' : undefined}
                  >
                    {sharedCustomers[broker] && '🤝 '}{broker} {selectedBroker === broker && ' ✓'}
                  </span>
                  <div className="flex items-center space-x-1 ml-2">
                    {sharing && (
                      <button
                        onClick={() => openShareDialog(broker)}
                        title="Share this customer with teammates"
                        className="bg-slate-700 hover:bg-emerald-600 text-gray-200 hover:text-white px-1.5 py-0.5 rounded text-[10px]"
                      >
                        🤝 Share
                      </button>
                    )}
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
            <span>{isGlobalSearch ? `${visibleOrderEntries.length} matches · All customers` : `${filteredOrders.length} shown · ${orders.length} loads · ${entCount} ENT`}</span>
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
                  className={`px-2 py-1 text-[11px] rounded font-semibold ${tab === 'OPEN' ? `tms-open ${filter === tab ? 'ring-2 ring-emerald-200' : ''}` : tab === 'ENT' ? `tms-ent ${filter === tab ? 'ring-2 ring-yellow-200' : ''}` : tab === 'ON HOLD' ? filter === tab ? 'bg-red-600 text-white ring-2 ring-red-300' : 'bg-red-700 hover:bg-red-600 text-white' : filter === tab ? 'bg-blue-600 text-white' : 'bg-[#1c2541] text-gray-400'}`}
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
              <span className="text-[11px] text-gray-400">{isGlobalSearch ? 'Select All (current customer)' : 'Select All'}</span>
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
              placeholder="🔍 All customers: load #, city, state..."
              aria-label="Search loads across all customers"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-1.5 text-xs text-white placeholder-gray-500 outline-none focus:border-blue-500"
            />
          </div>
          {isGlobalSearch && (
            <p className="mt-1 text-[10px] text-gray-400">
              All customers · Current status and lane filters apply. Click a result to open its customer.
              Bulk selection and export apply to the selected customer only.
            </p>
          )}
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
            <button
              type="button"
              onClick={() => setLaneSort(current => current === 'pickup-asc' ? 'pickup-desc' : 'pickup-asc')}
              className={`w-full rounded border p-1.5 text-xs font-semibold ${laneSort.startsWith('pickup') ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#0b132b] border-[#1c2541] text-white hover:border-blue-500'}`}
            >
              {laneSort === 'pickup-asc' ? 'Pickup date: earliest first ↑' : laneSort === 'pickup-desc' ? 'Pickup date: latest first ↓' : 'Sort by pickup date'}
            </button>
          </div>
          <div className="mt-1.5">
            <select
              aria-label="Sort loads by city and state"
              value={laneSort.startsWith('pickup') ? '' : laneSort}
              onChange={e => setLaneSort(e.target.value)}
              className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-1.5 text-xs text-white outline-none focus:border-blue-500"
            >
              <option value="">Sort by city/state (default)</option>
              <option value="origin-asc">Pickup city: A to Z</option>
              <option value="origin-desc">Pickup city: Z to A</option>
              <option value="destination-asc">Delivery city: A to Z</option>
              <option value="destination-desc">Delivery city: Z to A</option>
              <option value="origin-state-asc">Pickup state: A to Z</option>
              <option value="origin-state-desc">Pickup state: Z to A</option>
              <option value="destination-state-asc">Delivery state: A to Z</option>
              <option value="destination-state-desc">Delivery state: Z to A</option>
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
          {visibleOrderEntries.length === 0 ? (
            <div className="text-center text-gray-500 text-xs py-10">{isGlobalSearch ? 'No matching loads across all customers with the current filters.' : `No loads found for ${selectedBroker}. Click "📂 Import Excel" above!`}</div>
          ) : (
            visibleOrderEntries.map(({ customer, order: ord }) => (
              <div
                key={JSON.stringify([customer, ord.id])}
                onClick={() => handleSelectSearchResult(customer, ord)}
                className={`tms-load-card p-3 rounded-lg cursor-pointer border transition-all flex items-start space-x-2.5 ${
                  customer === selectedBroker && exportErrorIds.includes(String(ord.id))
                    ? 'bg-red-950/50 border-red-500 shadow-md'
                    : customer === selectedBroker && selectedOrder?.id === ord.id
                      ? 'bg-[#1c2541] border-blue-500 shadow-md'
                      : 'bg-[#161f36]/60 border-transparent hover:bg-[#1c2541]/50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={customer === selectedBroker && selectedIds.includes(ord.id)}
                  disabled={customer !== selectedBroker}
                  title={customer !== selectedBroker ? 'Open this load to select its customer first' : 'Select load'}
                  onChange={(e) => handleToggleSelect(ord.id, e)}
                  className="mt-1 cursor-pointer accent-blue-600"
                />
                <div className="flex-1 min-w-0">
                  {isGlobalSearch && <div className="text-[10px] text-teal-200 mb-1">{customer}</div>}
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-sm text-blue-400">{ord.id}</span>
                      {customer === selectedBroker && exportErrorIds.includes(String(ord.id)) && (
                        <span className="bg-red-700 text-white text-[9px] px-1.5 py-0.5 rounded font-bold">EXPORT ERROR</span>
                      )}
                      <span className="bg-blue-900/60 text-blue-300 text-[10px] px-1.5 py-0.5 rounded font-mono" title={getEquipmentDescription(ord.eCode)}>{getDisplayEquipmentCode(ord.eCode)}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${ord.status === 'ENT' ? 'tms-ent' : ord.status === 'ON HOLD' ? 'bg-red-900/60 text-red-300' : ord.status === 'OPEN' ? 'tms-open' : 'bg-blue-900/60 text-blue-300'}`}>{ord.status}</span>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${ord.tag === 'ENT' ? 'tms-ent' : ord.tag === 'HOLD' ? 'bg-red-600 text-white' : ord.tag === 'OPEN' ? 'tms-open' : 'bg-blue-600 text-white'}`}>{ord.tag}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mb-1 min-w-0">
                    <div className="text-xs font-medium text-gray-200 truncate">{ord.route}</div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); copyToClipboard(ord.route || '', 'Pickup and Delivery'); }}
                      title="Copy pickup and delivery city/state"
                      aria-label={`Copy route for load ${ord.id}`}
                      className="shrink-0 bg-slate-700 hover:bg-slate-600 text-white px-1.5 py-0.5 rounded text-[10px] cursor-pointer"
                    >📋</button>
                  </div>
                  <div className="text-[11px] text-gray-400">{ord.puDate} {ord.delDate}</div>
                  <div aria-label={`Rate for load ${ord.id}`} className="mt-1 text-xs text-emerald-400 font-bold">
                    Rate: ${(Number(String(ord.rateInput || '').replace(/[$,]/g, '')) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </div>
                  {ord.planningComment && <div className="mt-1 text-[11px] text-amber-300 font-semibold truncate">{ord.planningComment}</div>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="tms-workspace flex-1 flex flex-col overflow-y-auto p-6">
        <div className="tms-brand">
          <span>Broski Transportation &amp; Logistics</span>
          {profile.phone ? (
            <a className="tms-brand-phone" href={`tel:+1${profile.phone}`}>
              {countryFlags[profile.flag] && (
                <span
                  className="tms-colombia-flag"
                  role="img"
                  aria-label={`${countryFlags[profile.flag].name} flag`}
                  style={{ background: countryFlags[profile.flag].background }}
                />
              )}
              <span>{formatPhone(profile.phone)}</span>
            </a>
          ) : (
            <span className="text-xs text-amber-400">Add your phone in ⚙ My Settings</span>
          )}
          <button
            type="button"
            onClick={openProfileSettings}
            className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2.5 py-1 rounded font-medium cursor-pointer"
          >
            ⚙ My Settings
          </button>
        </div>
        {profileDraft && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60" role="dialog" aria-label="My Settings">
            <form onSubmit={handleSaveProfile} className="w-80 bg-[#121829] border border-[#1c2541] rounded-lg p-5 space-y-3">
              <h2 className="text-sm font-bold text-gray-100">⚙ My Settings</h2>
              <p className="text-[11px] text-gray-400">Used on your exports. Each teammate has their own.</p>
              {[
                ['phone', 'Call back phone (10 digits)', '484-555-1234'],
                ['postingCode', 'Posting code', 'ANQ'],
                ['visibilityGroup', 'Visibility group', 'ANQ']
              ].map(([field, label, example]) => (
                <label key={field} className="block text-xs text-gray-400">
                  {label}
                  <input
                    type="text"
                    value={profileDraft[field]}
                    onChange={(e) => setProfileDraft(current => ({ ...current, [field]: e.target.value }))}
                    placeholder={example}
                    className="mt-1 w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono"
                  />
                </label>
              ))}
              <label className="block text-xs text-gray-400">
                Flag next to your phone
                <div className="mt-1 flex items-center gap-2">
                  <select
                    value={profileDraft.flag}
                    onChange={(e) => setProfileDraft(current => ({ ...current, flag: e.target.value }))}
                    className="flex-1 bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white"
                  >
                    {Object.entries(countryFlags)
                      .sort(([, a], [, b]) => a.name.localeCompare(b.name))
                      .map(([code, flag]) => <option key={code} value={code}>{flag.name}</option>)}
                    <option value="NONE">No flag</option>
                  </select>
                  {countryFlags[profileDraft.flag] && (
                    <span className="tms-colombia-flag" aria-hidden="true" style={{ background: countryFlags[profileDraft.flag].background }} />
                  )}
                </div>
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setProfileDraft(null)} className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-1.5 text-xs rounded">Cancel</button>
                <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 text-xs rounded font-bold">Save</button>
              </div>
            </form>
          </div>
        )}
        {shareCustomerName && (() => {
          const shareInfo = sharedCustomers[shareCustomerName];
          const memberIds = shareInfo?.memberIds || [];
          const choices = teammates.filter(person => person.id !== shareInfo?.ownerId && !memberIds.includes(person.id));
          const closeShareDialog = () => {
            setShareCustomerName(null);
            setShareMessage('');
          };
          const renderChoices = (buttonLabel, onSubmit) => (
            <>
              {choices.length ? choices.map(person => (
                <label key={person.id} className="flex items-center gap-2 text-xs text-gray-200">
                  <input type="checkbox" checked={shareSelection.includes(person.id)} onChange={() => toggleShareSelection(person.id)} />
                  {person.email}
                </label>
              )) : <p className="text-[11px] text-gray-500">No other teammates to add.</p>}
              <button
                type="button"
                disabled={shareBusy || !shareSelection.length}
                onClick={onSubmit}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-1.5 text-xs rounded font-bold"
              >
                {buttonLabel}
              </button>
            </>
          );
          return (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60" role="dialog" aria-label="Share customer">
              <div className="w-96 max-h-[80vh] overflow-y-auto bg-[#121829] border border-[#1c2541] rounded-lg p-5 space-y-3">
                <h2 className="text-sm font-bold text-gray-100">🤝 Share “{shareCustomerName}”</h2>
                {!shareInfo && (
                  <>
                    <p className="text-[11px] text-gray-400">
                      Teammates you pick will see and edit this customer’s loads and lane rates live, together with you.
                      Everyone keeps their own phone, posting code and visibility group.
                    </p>
                    {renderChoices('Share', () => runShareAction(
                      () => sharing.shareCustomer(shareCustomerName, shareSelection),
                      'Shared. Your teammates will see this customer the next time their page updates.'
                    ))}
                  </>
                )}
                {shareInfo && (
                  <>
                    <p className="text-[11px] text-gray-400">
                      {shareInfo.isOwner ? 'You shared this customer.' : `Shared with you by ${teammateEmail(shareInfo.ownerId)}.`}
                    </p>
                    <div className="space-y-1">
                      <span className="text-[11px] font-bold text-gray-300">Shared with:</span>
                      {memberIds.length ? memberIds.map(memberId => (
                        <div key={memberId} className="flex items-center justify-between text-xs text-gray-200">
                          <span>{teammateEmail(memberId)}</span>
                          {shareInfo.isOwner && (
                            <button
                              type="button"
                              disabled={shareBusy}
                              onClick={() => runShareAction(() => sharing.removeSharedMember(shareCustomerName, memberId), 'Teammate removed.')}
                              className="bg-slate-700 hover:bg-red-600 text-white px-1.5 py-0.5 rounded text-[10px]"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      )) : <p className="text-[11px] text-gray-500">Nobody yet.</p>}
                    </div>
                    {shareInfo.isOwner ? (
                      <>
                        <span className="block text-[11px] font-bold text-gray-300">Add teammates:</span>
                        {renderChoices('Add', () => runShareAction(
                          () => sharing.addSharedMembers(shareCustomerName, shareSelection),
                          'Teammates added.'
                        ))}
                        <button
                          type="button"
                          disabled={shareBusy}
                          onClick={async () => {
                            if (!window.confirm(`Stop sharing "${shareCustomerName}"? Teammates lose access. You keep all its loads and lane rates.`)) return;
                            if (await runShareAction(() => sharing.stopSharingCustomer(shareCustomerName), '')) closeShareDialog();
                          }}
                          className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-3 py-1.5 text-xs rounded font-bold"
                        >
                          Stop sharing
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={shareBusy}
                        onClick={async () => {
                          if (!window.confirm(`Leave "${shareCustomerName}"? It will be removed from your list. The other teammates keep it.`)) return;
                          if (await runShareAction(() => sharing.leaveSharedCustomer(shareCustomerName), '')) closeShareDialog();
                        }}
                        className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-3 py-1.5 text-xs rounded font-bold"
                      >
                        Leave this customer
                      </button>
                    )}
                  </>
                )}
                {shareMessage && <p role="status" className="text-[11px] text-amber-300">{shareMessage}</p>}
                <button type="button" onClick={closeShareDialog} className="w-full bg-gray-600 hover:bg-gray-500 text-white px-3 py-1.5 text-xs rounded">
                  Close
                </button>
              </div>
            </div>
          );
        })()}
        {selectedOrder ? (
          <>
            <div className="tms-action-bar flex items-center justify-between bg-[#161f36] px-4 py-3 rounded-lg mb-6 border border-[#1c2541]">
              <div className="flex items-center space-x-3">
                <span className="text-xs font-bold text-gray-400">MOVE TO:</span>
                <button onClick={() => handleStatusChange('OPEN')} className="tms-open px-3 py-1 text-xs font-bold rounded cursor-pointer">OPEN</button>
                <button onClick={() => handleStatusChange('ON HOLD')} className="bg-red-600 hover:bg-red-500 px-3 py-1 text-xs font-bold rounded text-white cursor-pointer">ON HOLD</button>
                <button onClick={() => handleStatusChange('ENT')} className="tms-ent px-3 py-1 text-xs font-bold rounded cursor-pointer">ENT</button>
              </div>
              <div className="flex items-center gap-2">
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
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2.5 py-1 rounded font-semibold ${selectedOrder.tag === 'ENT' ? 'tms-ent' : selectedOrder.tag === 'HOLD' ? 'bg-red-600 text-white' : selectedOrder.tag === 'OPEN' ? 'tms-open' : 'bg-blue-600 text-white'}`}>{selectedOrder.tag}</span>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer"
                >
                  Delete Load
                </button>
              </div>
            </div>

            <div className="tms-load-details space-y-4 bg-[#161f36]/40 p-5 rounded-xl border border-[#1c2541]">
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
                  <input type="text" value={profile.visibilityGroup} placeholder="Set in ⚙ My Settings" readOnly title="Change in ⚙ My Settings" className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono placeholder-amber-400" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">EQUIPMENT</label>
                  {String(selectedOrder.eCode || '').trim().toUpperCase() === 'VE' && (
                    <>
                      <input type="text" value="VAN" readOnly aria-label="Mapped equipment" className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                      <label className="text-xs text-gray-400 block mt-2 mb-1">SOURCE EQUIPMENT CODE (VE = VAN / CHEM)</label>
                    </>
                  )}
                  <input type="text" value={isTeamEquipment(selectedOrder.eCode) ? 'V' : selectedOrder.eCode} onChange={(e) => handleInputChange('eCode', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white outline-none" />
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
                    value={selectedOrder.postingCode || profile.postingCode}
                    placeholder="Set in ⚙ My Settings"
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
                      <label className="text-xs text-emerald-400 font-bold">Rate ($) - DAT quote</label>
                      <span className="text-[10px] bg-emerald-950 text-emerald-300 px-1 py-0.2 rounded font-mono border border-emerald-600/40">
                        {selectedOrder.rateSource === 'dat-screenshot' ? 'From screenshot' : selectedOrder.rateSource === 'dat-api' ? 'From DAT API' : 'Manual'}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={['user-entered', 'dat-screenshot', 'dat-api'].includes(selectedOrder.rateSource) ? selectedOrder.rateInput || '' : ''}
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
                      {(() => {
                        const shownRate = ['user-entered', 'dat-screenshot', 'dat-api'].includes(selectedOrder.rateSource) ? selectedOrder.rateInput : '';
                        const rpm = getRatePerMile(shownRate, selectedOrder.miles);
                        return rpm ? (
                          <div aria-label="Rate per mile" title="Rate ÷ miles" className="shrink-0 flex items-center bg-emerald-950 border border-emerald-600/60 text-emerald-300 px-2 rounded text-xs font-mono font-bold whitespace-nowrap">
                            ${rpm}/mi
                          </div>
                        ) : null;
                      })()}
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">Saved automatically for future loads with this customer, origin/destination city and state, and equipment. ZIP differences do not affect matching. The latest entered rate is reused. Press Enter to go to the next load.</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-[1fr_8rem] gap-4">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Commodity</label>
                    <input
                      type="text"
                      value={getLandstarCommodity(selectedOrder.eCode)}
                      readOnly
                      className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="load-team" className="text-xs text-gray-400 block mb-1">Team</label>
                    <input
                      id="load-team"
                      type="text"
                      value={isTeamLoad(selectedOrder) ? 'true' : 'false'}
                      readOnly
                      className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white"
                    />
                  </div>
                </div>
              </div>

              {/* Driver & Equipment Assignment */}
              <div className="border border-[#1c2541] bg-[#121829]/60 p-4 rounded-lg">
                <h3 className="text-xs font-bold text-purple-400 uppercase tracking-wide mb-3">Driver & Equipment Assignment</h3>
                <div className="grid grid-cols-2 gap-4 mb-3">
                  <div>
                    <label htmlFor="assignment-driver" className="text-xs text-gray-400 block mb-1">Driver Name</label>
                    <div className="flex gap-1">
                      <input id="assignment-driver" type="text" value={selectedOrder.driver || ''} onChange={(e) => handleInputChange('driver', e.target.value)} placeholder="Enter driver name" className="min-w-0 w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                      <button type="button" onClick={() => copyToClipboard(selectedOrder.driver || '', 'Driver Name')} title="Copy Driver Name" aria-label="Copy Driver Name" className="shrink-0 bg-slate-700 hover:bg-slate-600 text-white px-2.5 rounded text-xs cursor-pointer">📋</button>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="assignment-truck" className="text-xs text-gray-400 block mb-1">Truck Number</label>
                    <div className="flex gap-1">
                      <input id="assignment-truck" type="text" value={selectedOrder.truck || ''} onChange={(e) => handleInputChange('truck', e.target.value)} placeholder="Truck number" className="min-w-0 w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                      <button type="button" onClick={() => copyToClipboard(selectedOrder.truck || '', 'Truck Number')} title="Copy Truck Number" aria-label="Copy Truck Number" className="shrink-0 bg-slate-700 hover:bg-slate-600 text-white px-2.5 rounded text-xs cursor-pointer">📋</button>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="assignment-trailer" className="text-xs text-gray-400 block mb-1">Trailer Number</label>
                    <div className="flex gap-1">
                      <input id="assignment-trailer" type="text" value={selectedOrder.trailer || ''} onChange={(e) => handleInputChange('trailer', e.target.value)} placeholder="Trailer number" className="min-w-0 w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                      <button type="button" onClick={() => copyToClipboard(selectedOrder.trailer || '', 'Trailer Number')} title="Copy Trailer Number" aria-label="Copy Trailer Number" className="shrink-0 bg-slate-700 hover:bg-slate-600 text-white px-2.5 rounded text-xs cursor-pointer">📋</button>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="assignment-pickup-eta" className="text-xs text-gray-400 block mb-1">Pickup ETA</label>
                    <input id="assignment-pickup-eta" type="text" value={selectedOrder.pickupEta || ''} onChange={(e) => handleInputChange('pickupEta', e.target.value)} placeholder="MM/DD/YYYY HH:mm (local pickup time)" className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                  </div>
                </div>
                <div className="mt-3">
                  <label htmlFor="assignment-driver-phone" className="text-xs text-gray-400 block mb-1">Driver Cell Phone</label>
                  <div className="flex gap-1">
                    <input id="assignment-driver-phone" type="tel" value={selectedOrder.driverPhone || ''} onChange={(e) => handleInputChange('driverPhone', e.target.value)} placeholder="Enter cell phone number" className="min-w-0 w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                    <button type="button" onClick={() => copyToClipboard(selectedOrder.driverPhone || '', 'Driver Cell Phone')} title="Copy Driver Cell Phone" aria-label="Copy Driver Cell Phone" className="shrink-0 bg-slate-700 hover:bg-slate-600 text-white px-2.5 rounded text-xs cursor-pointer">📋</button>
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
                  DAT API rate fetching is active. You can also open [RateView - DAT iQ](https://iq.dat.com/rateview) if needed.
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