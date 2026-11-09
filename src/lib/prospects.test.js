import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractProspects, buildProspectEmail, buildFollowUpEmail, defaultSubject, isFollowUpDue, isLandstarProspect, LANDSTAR_MC
} from './prospects.js';

test('extractProspects reads company, email, phone and lane from DAT OCR text', () => {
  const text = [
    'DALLAS, TX  ->  ATLANTA, GA   Van  45,000 lbs',
    'Apex Freight Solutions LLC',
    'john.smith@apexfreight.com  (555) 123-4567',
    '',
    'CHICAGO, IL, MEMPHIS, TN   Reefer',
    'bids@coldchainlogistics.com',
    'Cold Chain Logistics Inc 555-987-6543'
  ].join('\n');
  const prospects = extractProspects(text);
  assert.equal(prospects.length, 2);
  assert.equal(prospects[0].email, 'john.smith@apexfreight.com');
  assert.equal(prospects[0].phone, '(555) 123-4567');
  assert.equal(prospects[0].company, 'Apex Freight Solutions LLC');
  assert.equal(prospects[0].lane, 'DALLAS, TX -> ATLANTA, GA');
  assert.equal(prospects[1].email, 'bids@coldchainlogistics.com');
  assert.equal(prospects[1].company, 'Cold Chain Logistics Inc');
  assert.equal(prospects[1].lane, 'CHICAGO, IL -> MEMPHIS, TN');
});

test('extractProspects dedupes addresses and cleans common OCR noise', () => {
  const text = 'Sales@Broker.com,\nsales@broker.com again\nnothing here';
  const prospects = extractProspects(text);
  assert.equal(prospects.length, 1);
  assert.equal(prospects[0].email, 'sales@broker.com');
});

test('intro email says Landstar MC, no double brokering and updates - never Broski', () => {
  const text = buildProspectEmail(
    { contact: 'Jane Doe', email: 'jane@x.com', lane: 'EAGAN, MN -> LOUISVILLE, KY' },
    { yourName: 'Daniel', phone: '484-575-6486', email: 'trucks1224@gmail.com' }
  );
  assert.match(text, /^Hello Jane,/);
  assert.match(text, new RegExp(`MC# ${LANDSTAR_MC}`));
  assert.match(text, /WE DO NOT DOUBLE BROKER/);
  assert.match(text, /WE STAY ON TOP OF OUR UPDATES/);
  assert.match(text, /proof of delivery/i);
  assert.match(text, /EAGAN, MN -> LOUISVILLE, KY/);
  assert.match(text, /Independent Agent for Landstar/);
  assert.doesNotMatch(text, /broski/i);
});

test('follow-up email keeps the two key points and the MC number', () => {
  const text = buildFollowUpEmail({ email: 'a@b.com' }, { yourName: 'Daniel' });
  assert.match(text, /^Hello,/);
  assert.match(text, /do not double broker/i);
  assert.match(text, /stay on top of our updates/i);
  assert.match(text, new RegExp(`MC# ${LANDSTAR_MC}`));
  assert.doesNotMatch(text, /broski/i);
});

test('subject carries the MC number', () => {
  assert.match(defaultSubject(), new RegExp(`MC# ${LANDSTAR_MC}`));
});

test('Landstar agencies are never prospects', () => {
  assert.equal(isLandstarProspect({ company: 'Landstar Ligon', email: 'x@y.com' }), true);
  assert.equal(isLandstarProspect({ company: 'Acme Freight', email: 'kim@landstarmail.com' }), true);
  assert.equal(isLandstarProspect({ company: 'Acme Freight', email: 'kim@acme.com' }), false);
});

test('follow-up is due 3 days after the intro email, only while still "emailed"', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const emailed = { status: 'emailed', emailed_at: '2026-11-05T12:00:00Z' };
  assert.equal(isFollowUpDue(emailed, now), true);
  assert.equal(isFollowUpDue({ ...emailed, emailed_at: '2026-11-08T12:00:00Z' }, now), false);
  assert.equal(isFollowUpDue({ ...emailed, status: 'replied' }, now), false);
  assert.equal(isFollowUpDue({ ...emailed, status: 'new' }, now), false);
  assert.equal(isFollowUpDue({ status: 'emailed' }, now), false);
});
