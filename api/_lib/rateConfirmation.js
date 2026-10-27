const stateCodes = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));

function formatTime(hour, minute) {
  const h = Number(hour);
  const m = Number(minute);
  if (h > 23 || m > 59) return '';
  return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
}

function findDates(text) {
  return Array.from(text.matchAll(
    /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b(?:[^\d\n]{0,12}?(\d{1,2}):(\d{2})(?:\s*(?:-|–|to)\s*(\d{1,2}):(\d{2}))?)?/gi
  )).map(match => {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    const date = `${match[1].padStart(2, '0')}/${match[2].padStart(2, '0')}/${year}`;
    const start = match[4] ? formatTime(match[4], match[5]) : '';
    const end = match[6] ? formatTime(match[6], match[7]) : '';
    return { date, start, end };
  });
}

function findPlaces(text) {
  const places = [];
  for (const line of text.split('\n')) {
    const match = line.match(/([A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){0,2}),\s*([A-Z]{2})\b(?:\s+(\d{5}))?/);
    if (!match || !stateCodes.has(match[2])) continue;
    places.push({ city: match[1].toUpperCase(), state: match[2], zip: match[3] || '' });
  }
  return places;
}

function windowText(date, fallbackStart, fallbackEnd) {
  return `${date.date} ${date.start || fallbackStart} - ${date.end || date.start || fallbackEnd}`;
}

// Best-effort reader for a rate-confirmation email. It only returns a load when it
// finds an order number, origin, destination, weight and pickup date, and it flags
// every load for review so nothing unverified is exported by accident.
export function parseRateConfirmation(subject, messageText, customer) {
  const id = String(subject || '').match(/order\s*:?\s*#?\s*(\d{5,10})/i)?.[1];
  if (!id) return [];

  const text = String(messageText || '').replace(/\r/g, '\n').replace(/\t/g, ' ');
  const places = findPlaces(text);
  const origin = places[0];
  const destination = places.find(place => place.city !== origin?.city || place.state !== origin?.state);
  const weight = text.match(/(\d{1,3}(?:,\d{3})+|\d{4,6})\s*(?:lbs?\b|pounds)/i)?.[1]?.replace(/,/g, '');
  const dates = findDates(text);
  if (!origin || !destination || !weight || !dates.length) return [];

  const pickup = dates[0];
  const delivery = dates[1];
  const emailRate = text.match(/(?:total|rate|linehaul|carrier pay|all[- ]in)[^\d$\n]{0,25}\$\s*([\d,]+(?:\.\d{2})?)/i)?.[1];
  const notes = ['Imported automatically from email – verify details before export.'];
  if (emailRate) notes.push(`Rate found in email: $${emailRate}`);
  if (!delivery) notes.push('Delivery date not found in email.');

  return [{
    id,
    postingCode: 'ANQ',
    visibilityGroup: 'ANQ',
    eCode: 'VAN:VAN',
    status: 'OPEN',
    tag: 'OPEN',
    route: `${origin.city}, ${origin.state} → ${destination.city}, ${destination.state}`,
    puDate: `PU: ${pickup.date}`,
    delDate: delivery ? `DFL: ${delivery.date}` : 'DFL: Upcoming',
    pickupTime: windowText(pickup, '0800', '1600'),
    deliveryTime: delivery ? windowText(delivery, '0800', '1600') : '',
    origCity: origin.city,
    origSt: origin.state,
    origZip: origin.zip,
    weight: `${weight} lbs`,
    destCity: destination.city,
    destSt: destination.state,
    destZip: destination.zip,
    miles: '',
    planningComment: 'Imported from email',
    carrier: '',
    driver: '',
    truck: '',
    trailer: '',
    rateInput: '',
    brokerable: 'false',
    notes: notes.join(' '),
    customer
  }];
}
