// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { isParamountTrackingCustomer } from '../lib/trackingEmails.js';
import { isTeamEquipment, normalizeEquipmentCode } from './equipment.js';
import { getSavedLaneRate } from './laneRates.js';
import { isNolanCustomer, isRxoCustomer, holdsRedScreenshotLoads } from './customers.js';

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
  // Both Paramount accounts (ATZ and ATZ H) send the same screenshot, whose clipped time cells
  // show hours only ("08..."). ATZ H read them as minutes (0008) and Landstar rejected loads
  // whose delivery then ended before pickup (2026-11-20).
  const isParaImport = isParamountTrackingCustomer(selectedBroker);
  const holdsRedRows = holdsRedScreenshotLoads(selectedBroker);
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
      || equipmentText.toUpperCase().match(/\b(V53|VM|VT|VZ|VE|VR|RZ|R|F|FV|FH|SD|VAN|V)\b/)?.[0]?.replace(/^V53$/, 'V') || '';
    const rowText = line.text.toLowerCase();
    if (/distance/.test(rowText) && /weight/.test(rowText) && /comment/.test(rowText)) return null;
    if (/\border\b/.test(rowText) && /\bearly\b/.test(rowText) && /\blate\b/.test(rowText)) return null;
    // A row whose city didn't read used to vanish. Keep it whenever the order number is
    // known, flagged "verify", so it imports and you can fix the city instead of losing it.
    if (!origCity && !destCity && !id) return null;

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
      status: holdsRedRows && line.orderNumberHighlighted ? 'ON HOLD' : 'OPEN',
      tag: holdsRedRows && line.orderNumberHighlighted ? 'HOLD' : 'OPEN',
      ...(holdsRedRows && typeof line.orderNumberHighlighted === 'boolean'
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
      notes: id && originState && origin && destination ? '' : 'Some fields were unreadable from the screenshot; please verify the cities, state codes and times.'
    };
  }).filter(Boolean);
}

function findNtgCards(lines, imageWidth, imageHeight, { wholeCard = false } = {}) {
  const words = lines.flatMap(line => line.words || [])
    .map(word => {
      const x0 = word.bbox.x0 / imageWidth;
      const x1 = word.bbox.x1 / imageWidth;
      return { text: String(word.text || '').trim(), x0, x1, cx: (x0 + x1) / 2, cy: (word.bbox.y0 + word.bbox.y1) / 2, h: word.bbox.y1 - word.bbox.y0 };
    })
    .filter(word => word.text);
  if (wholeCard) {
    return { cards: words.length ? [{ cy: imageHeight * 0.3, top: 0, bottom: imageHeight, words }] : [], spacing: imageHeight };
  }
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

function parseNtgScreenshotLines(lines, imageWidth, imageHeight, options = {}) {
  const { cards: anchors } = findNtgCards(lines, imageWidth, imageHeight, options);
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
    const match = text.replace(/[|]/g, '').replace(/(\s+\d{1,2})+\s*$/, '').match(/^(.*?)[,.]?\s+([A-Za-z]{2})$/);
    const state = match?.[2].toUpperCase();
    if (!match || !stateCodes.has(state)) return null;
    const city = match[1].replace(/[^A-Za-z\s.'-]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
    return city ? { city, state } : null;
  };
  const parseDates = text => {
    const cleaned = text.replace(/[Oo]/g, '0').replace(/(\d)\s*[vV|\\]\s*(\d)/g, '$1/$2');
    const dateMatch = cleaned.match(/(1[0-2]|0?[1-9])\s*\/?\s*(3[01]|[12]\d|0?[1-9])\s*\/\s*(20\d{2}|\d{2})/);
    if (!dateMatch) return '';
    const date = `${dateMatch[1].padStart(2, '0')}/${dateMatch[2].padStart(2, '0')}/${dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3]}`;
    const timeText = cleaned.slice(dateMatch.index + dateMatch[0].length)
      .replace(/\b[D0]?[BR0-9][\s:;.]*\d{2}\b/g, value => value.replace(/D/g, '0').replace(/[BR]/g, '8'));
    const times = Array.from(timeText.matchAll(/\b([01]?\d|2[0-3])\s*[:;.]?\s*([0-5]\d)\b/g))
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
      .filter(word => word.cx >= statsLeft && word !== rateWord && /^(\d{1,3}([,.]\d{3})+|\d{2,6})(\.\d+)?$/.test(word.text))
      .sort((a, b) => a.x0 - b.x0)[0];
    // "2.293" is a misread "2,293"; a decimal weight like "39,974.4" keeps its decimal.
    const weightText = weightWord ? weightWord.text.replace(/^(\d{1,3})\.(\d{3})(?=$|\.)/, '$1,$2') : '';
    let weightValue = weightWord ? Math.round(Number(weightText.replace(/,/g, ''))) : 0;
    // OCR sometimes drops the separators in weights like "39,974.4", producing 399744.
    while (weightValue > 60000 && !/[.,]/.test(weightWord.text)) weightValue = Math.round(weightValue / 10);
    const weight = weightValue ? String(weightValue) : '';

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
    const tags = [/haz|\b\w{1,2}zmat\b/i.test(equipmentText) && 'Hazmat', /tanker/i.test(equipmentText) && 'Tanker (N) Endorsement'].filter(Boolean);
    const isHazmat = tags.includes('Hazmat');
    const shortDate = value => value.replace(/^(\d{2})\/(\d{2})\/\d{4}\s+(\d{4}).*$/, '$1/$2 $3');
    return {
      id: idWord ? idWord.text : `NTG-${Date.now()}-${index}`,
      eCode: /str\w{0,3}ght\s*tr\w*|sprinter|box\s*truck/i.test(equipmentText) ? normalizeEquipmentCode(`Straight Truck ${equipmentText}`) : /c\w{1,3}est\w{0,2}ga/i.test(equipmentText) ? 'FLCS' : isFlatbed ? (isHazmat ? 'FH' : 'F,SD') : isHazmat ? (isReefer && !/\bvan\b/i.test(equipmentText) ? 'RZ' : 'VZ') : isReefer ? (/\bvan\b/i.test(equipmentText) ? 'VR' : 'R') : 'V',
      ...(isHazmat ? { hazmat: 'true' } : {}),
      ...(tags.some(tag => /tanker/i.test(tag)) ? { tanker: 'true' } : {}),
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

function parseDatScreenshotLines(lines, imageWidth, imageHeight, selectedBroker, laneRates) {
  const allBbox = lines.flatMap(line => [line.bbox, ...(line.words || []).map(word => word.bbox)].filter(Boolean));
  if (!(imageWidth > 0) && allBbox.length) imageWidth = Math.max(...allBbox.map(b => b.x1 || 0));
  if (!(imageHeight > 0) && allBbox.length) imageHeight = Math.max(...allBbox.map(b => b.y1 || 0));
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
    pickup: /^pick(?:\s*up)?$/i,
    equipment: /^e[sq5)\]]+$/i,
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
      .match(/\b(VT|VAN|V|R|F|SD|VR|RZ|VZ|VE|FH|RG|ST|LB|AC|HS|HR|LA|SR|SS|TT|VA|VF|VS|DD|DT|FA|FB|FD|FN|FR|FT|GN|LS|LT|NB|NF|NG|NR|NS|OT|PD|PO|RA|RE|RF|RN|RO|RS|RT|SB|SC|SK|SL|SN|SO|SQ|SW|TA|TB|TC|TD|TE|TF|TG|TH|TK|TL|TM|TN|TO|TP|TR|TS|TU|TV|TW|TX|TY|TZ)\b/)?.[0];
    if (fromCell) return fromCell;
    const date = line.text.match(/\b(?:1[0-2]|0?[1-9])\s*[/.-]\s*(?:3[01]|[12]\d|0?[1-9])\b/);
    return date
      ? line.text.slice(date.index + date[0].length).toUpperCase()
        .match(/\b(VT|VAN|VV|V|R|F|SD|VR|RZ|VZ|VE|FH|RG|ST|LB|AC|HS|HR|LA|SR|SS|TT|VA|VF|VS|DD|DT|FA|FB|FD|FN|FR|FT|GN|LS|LT|NB|NF|NG|NR|NS|OT|PD|PO|RA|RE|RF|RN|RO|RS|RT|SB|SC|SK|SL|SN|SO|SQ|SW|TA|TB|TC|TD|TE|TF|TG|TH|TK|TL|TM|TN|TO|TP|TR|TS|TU|TV|TW|TX|TY|TZ)\b/)?.[0]?.replace(/^VV$/, 'V') || ''
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
    const equipment = tail.match(/\b(VT|VAN|VV|V|R|F|SD|VR|RZ|VZ|VE|FH|RG|ST|LB|AC|HS|HR|LA|SR|SS|TT|VA|VF|VS|DD|DT|FA|FB|FD|FN|FR|FT|GN|LS|LT|NB|NF|NG|NR|NS|OT|PD|PO|RA|RE|RF|RN|RO|RS|RT|SB|SC|SK|SL|SN|SO|SQ|SW|TA|TB|TC|TD|TE|TF|TG|TH|TK|TL|TM|TN|TO|TP|TR|TS|TU|TV|TW|TX|TY|TZ)\b/i)?.[0]?.toUpperCase().replace(/^VV$/, 'V') || '';
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
    const pickupBounds = getCellBounds('pickup');
    const rowCenterY = (line.bbox.y0 + line.bbox.y1) / 2;
    const pickupWords = pickupBounds
      ? allWords.filter(word => {
        const centerX = (word.bbox.x0 + word.bbox.x1) / 2 / imageWidth;
        const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
        return centerX >= pickupBounds.left && centerX < pickupBounds.right
          && centerY > tripHeaderY
          && Math.abs(centerY - rowCenterY) <= rowTolerance * 2;
      })
      : line.words;
    const pickupCell = cleanCell(pickupWords) || getHeaderCell(line, 'pickup');
    const pickupRange = pickupCell.match(/(\d{1,2}\s*\/\s*\d{1,2})\s*[-–—]\s*(\d{1,2}\s*\/\s*\d{1,2})/)
      || line.text.match(/(\d{1,2}\s*\/\s*\d{1,2})\s*[-–—]\s*(\d{1,2}\s*\/\s*\d{1,2})/);
    const pickupDate = getDate(pickupRange?.[1] || pickupCell) || textRow?.pickupDate || '';
    const pickupEndDate = pickupRange ? getDate(pickupRange[2]) : '';
    const equipmentText = getHeaderCell(line, 'equipment').toUpperCase().replace(/^VV$/, 'V');
    const equipment = equipmentText.match(/\b(VT|VAN|V|R|F|SD|VR|RZ|VZ|VE|FH|RG|ST|LB|AC|HS|HR|LA|SR|SS|TT|VA|VF|VS|DD|DT|FA|FB|FD|FN|FR|FT|GN|LS|LT|NB|NF|NG|NR|NS|OT|PD|PO|RA|RE|RF|RN|RO|RS|RT|SB|SC|SK|SL|SN|SO|SQ|SW|TA|TB|TC|TD|TE|TF|TG|TH|TK|TL|TM|TN|TO|TP|TR|TS|TU|TV|TW|TX|TY|TZ)\b/)?.[0]
      || textRow?.equipment
      || reliableDominantEquipment
      || 'V';
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
        rateLine.match(/(?:\$\s*)(\d[\d,]*(?:\.\d{1,2})?)/)?.[1]?.replace(/,/g, '')
          || rateLine.replace(/,/g, '').match(/(?:\$\s*)?(\d{3,})\b/)?.[1]
          || 0
      ))
      .find(rateValue => rateValue >= 100) || 0;
    const rateText = getHeaderCell(line, 'rate');
    const directRate = /\$/.test(rateText)
      ? Number(rateText.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/)?.[1]?.replace(/,/g, '') || 0)
      : 0;
    const rowCenter = (line.bbox.y0 + line.bbox.y1) / 2;
    const nearestRate = rateObservations
      .map(observation => ({ ...observation, distance: Math.abs(observation.y - rowCenter) }))
      .filter(observation => observation.distance <= imageHeight * 0.045)
      .sort((a, b) => a.distance - b.distance)[0];
    const rate = positionedRate || directRate || nearestRate?.rate || 0;
    const hasWeight = Number(weight?.replace(/,/g, '')) > 0;
    const equipmentWasGuessed = !equipmentText.match(/\b(VT|VAN|V|R|F|SD|VR|RZ|VZ|VE|FH|RG)\b/) && !textRow?.equipment;
    if (!origin || !destination || !pickupDate || !equipment) return;
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
      pickupTime: pickupEndDate
        ? `${pickupDate} 0800 - ${pickupEndDate} 1600`
        : `${pickupDate} 0800 - 1600`,
      origCity: origin.city,
      origSt: origin.state,
      origZip: '',
      weight: hasWeight ? `${weight} lbs` : '40000 lbs',
      deliveryTime: isNolanCustomer(selectedBroker) ? '' : '0800 - 1600',
      destCity: destination.city,
      destSt: destination.state,
      destZip: '',
      miles: trip,
      planningComment: [
        'Imported from DAT screenshot',
        !hasWeight && 'weight not visible — enter weight',
        equipmentWasGuessed && 'equipment not read — confirm equipment'
      ].filter(Boolean).join('; '),
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
    // Your saved rate for this lane beats the rate on the DAT screenshot.
    const savedLaneRate = getSavedLaneRate(laneRates, selectedBroker, order);
    if (savedLaneRate) {
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

    const mode = /^R/.test(modeText) ? 'R' : /^F/.test(modeText) ? 'F,SD' : 'V';
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

function normalizeMilesValue(value) {
  const compact = String(value ?? '').replace(/[\s,]/g, '');
  if (/^\d{1,4}(\.\d+)?$/.test(compact)) return compact;
  const decimal = compact.match(/(\d{1,4})\.(\d)/);
  if (decimal) return `${decimal[1]}.${decimal[2]}`;
  const digits = compact.replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(0, -6) : digits;
}

export {
  screenshotColumns,
  stateCodes,
  clusterPositions,
  detectColumnsFromData,
  detectScreenshotColumns,
  detectColumnsFromHeader,
  parseWeightPounds,
  parseScreenshotLines,
  findNtgCards,
  parseNtgScreenshotLines,
  editDistance,
  parseDatScreenshotLines,
  findChHeaders,
  getChColumnBounds,
  parseChWeight,
  parseChScreenshotLines,
  normalizeMilesValue
};
