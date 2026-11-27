// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { getSavedLaneRate } from './laneRates.js';
import { isCh593772Customer } from './customers.js';

// ==========================================
// ZIP CODE AUTO-FILL DICTIONARY & HELPER
// ==========================================
const zipDatabase = {
  "PARCHMENT, MI": "49004",
  "STONE MOUNTAIN, GA": "30083",
  // 08520 is filed under Hightstown in the offline ZIP data.
  "EAST WINDSOR, NJ": "08520",
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

function parseGmailLoadEmail(messageText, selectedBroker, laneRates) {
  const isChCustomer = isCh593772Customer(selectedBroker);
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
  // Hours cells look like "A 14:30 - 14:30", "O 08:00 - 15:00", or "00:00 - 23:59".
  const parseHours = text => {
    const match = String(text || '').match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
    if (!match || Number(match[1]) > 23 || Number(match[3]) > 23
      || Number(match[2]) > 59 || Number(match[4]) > 59) return '';
    const pad = value => String(value).padStart(2, '0');
    return `${pad(match[1])}${match[2]} - ${pad(match[3])}${match[4]}`;
  };
  const createLoad = (id, origin, originState, destination, destinationState, weightText, trailingText = '', schedule = {}) => {
    const weight = weightText.match(/[\d,]+(?:\.\d+)?/)?.[0] || '';
    if (!pickupDate || !origin || !destination || !weight) return;
    const tailParts = trailingText.match(/[\d,]+(?:\.\d+)?/g) || [];
    const miles = isChCustomer
      ? ''
      : tailParts.length ? tailParts[0].replace(/,/g, '') : '';
    const eCode = /\bHAZMAT\b/i.test(messageText.slice(0, 500)) ? 'VZ' : 'VAN:VAN';
    const deliveryDate = parseDate(schedule.deliveryDate);
    const order = {
      id,
      eCode,
      status: 'OPEN',
      tag: 'OPEN',
      route: `${origin.toUpperCase()}, ${originState.toUpperCase()} → ${destination.toUpperCase()}, ${destinationState.toUpperCase()}`,
      puDate: `PU: ${pickupDate}`,
      delDate: deliveryDate ? `DFL: ${deliveryDate}` : 'DFL: Upcoming',
      pickupTime: `${pickupDate} ${parseHours(schedule.pickupHours) || '0800 - 1600'}`,
      deliveryTime: deliveryDate ? `${deliveryDate} ${parseHours(schedule.deliveryHours) || '0800 - 1600'}` : '',
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
      rateInput: isChCustomer
        ? String(Number(trailingText.trim().match(/^\$?([\d,]+(?:\.\d+)?)(?:\s|$)/)?.[1]?.replace(/,/g, '')) || 0)
        : '',
      ...(isChCustomer ? { rateSource: 'customer-bin' } : {}),
      brokerable: 'false',
      notes: deliveryDate ? '' : 'Delivery date/time not included in email; please enter before export.'
    };
    const savedLaneRate = !isChCustomer && getSavedLaneRate(laneRates, selectedBroker, order);
    if (savedLaneRate) {
      order.rateInput = savedLaneRate;
      order.rateSource = 'user-entered';
    }
    loads.push(order);
  };

  const tableRows = String(messageText || '').split(/\r?\n/).map(line => line.split('\t').map(cell => cell.trim()));
  if (isChCustomer && tableRows.some(cells => /^\d{8,10}$/.test(cells[0]) && cells.length >= 7)) {
    // Column positions come from the header row: the customer added Pickup Hours (6th),
    // Delivery Hours (11th), and Delivery Date (12th) columns, shifting Weight and Bin.
    const headerCells = tableRows.find(cells => cells.some(cell => /^load\s*#/i.test(cell))
      && cells.some(cell => /^bin\b/i.test(cell))) || [];
    const findColumn = pattern => headerCells.findIndex(cell => pattern.test(cell));
    const weightColumn = findColumn(/^weight\b/i);
    const binColumn = findColumn(/^bin\b/i);
    const pickupHoursColumn = findColumn(/^pickup\s*hours\b/i);
    const deliveryHoursColumn = findColumn(/^delivery\s*hours\b/i);
    const deliveryDateColumn = findColumn(/^delivery\s*date\b/i);
    for (const cells of tableRows) {
      const dateHeading = cells[0].match(/\b(\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4}))\s*-\s*[A-Za-z]{3,9}\b/);
      if (dateHeading) pickupDate = parseDate(dateHeading[1]);
      if (!/^\d{8,10}$/.test(cells[0]) || cells.length < 7) continue;
      createLoad(cells[0], cells[1], cells[2], cells[3], cells[4],
        cells[weightColumn >= 0 ? weightColumn : 5] || '',
        cells[binColumn >= 0 ? binColumn : 6] || '',
        {
          pickupHours: pickupHoursColumn >= 0 ? cells[pickupHoursColumn] : '',
          deliveryHours: deliveryHoursColumn >= 0 ? cells[deliveryHoursColumn] : '',
          deliveryDate: deliveryDateColumn >= 0 ? cells[deliveryDateColumn] : ''
        });
    }
    return autoFillLoadZipCodes(loads);
  }

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

export {
  zipDatabase,
  autoFillLoadZipCodes,
  parseGmailLoadEmail
};
