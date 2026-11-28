// Turns the load rows Claude read from a customer's screenshot (api/_lib/readScreenshot.js) into
// TMS loads, the same shape the built-in screenshot reader makes. Tested in aiScreenshot.test.js.

const clean = value => String(value ?? '').trim();
const digits = value => clean(value).replace(/[^\d.]/g, '').replace(/\.\d*$/, '');
const shortDateTime = value => clean(value).replace(/^(\d{2})\/(\d{2})\/\d{2}(\d{2})/, '$1/$2/$3');

export function aiRowToLoad(row, { index = 0, now = Date.now(), holdsOnHold = true } = {}) {
  const origin = clean(row?.origCity).toUpperCase();
  const originState = clean(row?.origState).toUpperCase().slice(0, 2);
  const destination = clean(row?.destCity).toUpperCase();
  const destinationState = clean(row?.destState).toUpperCase().slice(0, 2);
  const pickupFrom = clean(row?.pickupFrom);
  const pickupTo = clean(row?.pickupTo);
  const deliveryFrom = clean(row?.deliveryFrom);
  const deliveryTo = clean(row?.deliveryTo);
  const weight = digits(row?.weight);
  const onHold = holdsOnHold && Boolean(row?.onHold);
  const id = clean(row?.loadId);
  const missing = !id || !origin || !originState || !destination || !destinationState;
  return {
    id: id || `IMG-${now}-${index}`,
    eCode: clean(row?.equipment) || 'V',
    team: /team/i.test(clean(row?.equipment)) ? 'true' : 'false',
    status: onHold ? 'ON HOLD' : 'OPEN',
    tag: onHold ? 'HOLD' : 'OPEN',
    route: `${origin}${originState ? `, ${originState}` : ''} → ${destination}${destinationState ? `, ${destinationState}` : ''}`,
    puDate: pickupFrom || pickupTo ? `PU: ${shortDateTime(pickupFrom || pickupTo)}` : 'PU: Today',
    delDate: deliveryTo || deliveryFrom ? `DFL: ${shortDateTime(deliveryTo || deliveryFrom)}` : 'DFL: Upcoming',
    pickupTime: pickupFrom && pickupTo ? `${pickupFrom} - ${pickupTo}` : pickupFrom || pickupTo,
    deliveryTime: deliveryFrom && deliveryTo ? `${deliveryFrom} - ${deliveryTo}` : deliveryFrom || deliveryTo,
    origCity: origin,
    origSt: originState,
    origZip: clean(row?.origZip),
    destCity: destination,
    destSt: destinationState,
    destZip: clean(row?.destZip),
    weight: weight ? `${weight} lbs` : '',
    miles: digits(row?.miles),
    ...(row?.hazmat ? { hazmat: 'true' } : {}),
    planningComment: clean(row?.notes),
    carrier: '', driver: '', truck: '', trailer: '',
    rateInput: digits(row?.rate),
    ...(digits(row?.rate) ? { rateSource: 'user-entered' } : {}),
    brokerable: 'false',
    notes: missing ? 'Read by AI: some fields were missing; please check the load #, cities and states.' : ''
  };
}

// File -> { data (base64, no prefix), mediaType } for the server. In the browser a large picture
// is shrunk to at most MAX_SIDE pixels on its long side (a JPEG): the website takes at most ~4.5 MB
// per request, and a smaller picture reads just as well and costs less.
const MAX_SIDE = 1800;
export async function imageForAi(file) {
  if (typeof document !== 'undefined' && typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      if (scale < 1 || file.size > 1_500_000) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        return { data: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/jpeg' };
      }
    } catch {
      // Could not shrink it: send it as it is.
    }
  }
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { data: btoa(binary), mediaType: file.type || 'image/png' };
}
