const test = require('node:test');
const assert = require('node:assert/strict');
const { parseParamountRateCon } = require('./ratecon');

// Text read (OCR) from a real Paramount Load Confirmation, page 1 (rates left out).
const ocrText = "Paramount Logistics\nParamount Transportation Logistics Svcs Page 1\n315 NE 14th Street\nOcala, FL 34470\n877-510-9133 239-267-1910 Load Confirmation 2282980\nCarrier: LANDSTAR RANGER Contact: DANIEL URDANETA\nJACKSONVILLE FL 32224 Phone: 484-650-8300\nDate: 11/06/2026 Fax:\nOrder Order: 2282980 Commodity: Construction & Building Supplies / Materials\nMiles: 323.0 Weight: 40324.3 LB\nTemp: Trailer: Van Hazmat (DAT)\nBOL: 3001098403 Reference: ~~ 873200001\nCustoms Broker Info:\nPU1 Name: Martinsburg Distribution Center-- Date: 11/07/2026 1400\nAddress: 891 Auto Parts Place 11/07/2026 2345\nMartinsburg WV 25403 Driver Load: No driver loading or unload\nReference number: CR ©\nReference number: CR 0104081771\nReference number: CR Y\nReference number: PO 001294823\nReference number: TN 873200001\nS02 Name: SPECTRUM PAINT KNIGHTDALE Date: 11/09/2026 0000\nAddress: 520 HINTON OAKS BLVD 11/09/2026 2359\nKNIGHTDALE NC 27545 Driver Load: No driver loading or unload\nReference number: CR ©\nReference number: CR 0104081771\nReference number: CR Y\nReference number: PO 001294823\n";

test('reads order, BOL, reference and both stops from a Paramount rate confirmation', () => {
  const r = parseParamountRateCon(ocrText);
  assert.equal(r.error, undefined);
  assert.equal(r.order, '2282980');
  assert.equal(r.pickup.name, 'Martinsburg Distribution Center');
  assert.equal(r.pickup.address, '891 Auto Parts Place');
  assert.deepEqual([r.pickup.city, r.pickup.state, r.pickup.zip], ['Martinsburg', 'WV', '25403']);
  assert.deepEqual(r.pickup.early, { date: '11/07/2026', time: '14:00' });
  assert.deepEqual(r.pickup.late, { date: '11/07/2026', time: '23:45' });
  assert.equal(r.pickup.comments, 'BOL number 300-109-8403\nreference number 873200001');
  assert.deepEqual([r.drop.name, r.drop.address, r.drop.city, r.drop.state, r.drop.zip], ['SPECTRUM PAINT KNIGHTDALE', '520 HINTON OAKS BLVD', 'KNIGHTDALE', 'NC', '27545']);
  assert.deepEqual(r.drop.late, { date: '11/09/2026', time: '23:59' });
  assert.equal(r.drop.comments, '');
});

test('says what it could not read instead of guessing', () => {
  assert.match(parseParamountRateCon('Load Confirmation 2282980\nnothing else').error, /pickup, delivery/);
});

test('a misread date ("1170972026") and an empty Reference are handled', () => {
  const r = parseParamountRateCon("Paramount Logistics\nParamount Transportation Logistics Svcs Page 1\n315 NE 14th Street\nOcala, FL 34470\n877-510-9133 239-267-1910 Load Confirmation 2282514\nCarrier: LANDSTAR RANGER Contact: DANIEL URDANETA\nJACKSONVILLE FL 32224 Phone: 484-650-8300\nDate: 11/06/2026 Fax:\nOrder Order: 2282514 Commodity: DIMETHRYL SULFOXIDE\nMiles: 781.0 Weight: 20723.0 LB\nTemp: Trailer: Van (DAT)\nBOL: EGLV142603334817 Reference:\nCustoms Broker Info:\nPU1 Name: CODA LOGISTICS Date: 11/06/2026 0800\nAddress: 1501 WEST EDGAR ROAD MAN DOCR 7 11/06/2026 1500\nLINDEN NJ 07036 Driver Load: No driver loading or unload\nS02 Name: OAKWOOD PRODUCTS Date: 1170972026 0800\nAddress: 280 COMMERCIAL DRIVE 11/09/2026 1700\nESTILL SC 29918 Driver Load: No driver loading or unload\n");
  assert.equal(r.error, undefined);
  assert.equal(r.reference, '', 'empty Reference: nothing from the next line');
  assert.equal(r.pickup.comments, 'BOL number EGLV142603334817');
  assert.deepEqual(r.drop.early, { date: '11/09/2026', time: '08:00' });
  assert.deepEqual(r.drop.late, { date: '11/09/2026', time: '17:00' });
  assert.deepEqual([r.drop.city, r.drop.state, r.drop.zip], ['ESTILL', 'SC', '29918']);
});
