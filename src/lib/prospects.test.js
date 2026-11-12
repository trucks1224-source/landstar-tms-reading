import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractProspects, buildProspectEmail, buildFollowUpEmail, defaultSubject, prospectSubject, isFollowUpDue, isBlockedProspect, LANDSTAR_MC,
  buildDailyCheckInEmail, dailyCheckInSubject, isDailyCheckInDue, DAILY_CHECKIN_AFTER_HOURS,
  isLandstarRefusal, buildDeclineReplyEmail
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

test('the posting lane leads the subject when known', () => {
  assert.equal(
    prospectSubject({ lane: 'DALLAS, TX -> ATLANTA, GA' }, 'base subject'),
    `Truck for your DALLAS, TX -> ATLANTA, GA load - Landstar agent MC# ${LANDSTAR_MC}`
  );
  assert.equal(prospectSubject({ lane: '' }, 'base subject'), 'base subject');
  assert.equal(prospectSubject({}, ''), defaultSubject());
  assert.match(buildFollowUpEmail({ lane: 'EAGAN, MN -> LOUISVILLE, KY' }, { yourName: 'D' }), /your EAGAN, MN -> LOUISVILLE, KY posting/);
});

test('Nolan is excluded from all prospecting schedules by company and email', () => {
  for (const prospect of [
    { company: 'Nolan Transportation Group', email: 'person@example.com' },
    { company: 'Nolan 965974 - ATZ H' }, { company: 'NTG' },
    { email: 'person@ntgfreight.com' }, { email: 'person@ops.ntgfreight.com' },
    { email: 'person@nolantransportation.com' }, { email: 'person@nolan.com' }
  ]) {
    assert.equal(isBlockedProspect(prospect), true);
    assert.equal(isDailyCheckInDue(prospect), false);
    assert.equal(isFollowUpDue({ ...prospect, status: 'emailed', emailed_at: '2020-01-01' }), false);
  }
  assert.equal(isBlockedProspect({ company: 'RXO', email: 'ops@rxo.com' }), false);
  assert.equal(isBlockedProspect({ email: 'ops@notntgfreight.com' }), false);
});

test('Landstar agencies and TQL are never prospects', () => {
  assert.equal(isBlockedProspect({ company: 'Landstar Ligon', email: 'x@y.com' }), true);
  assert.equal(isBlockedProspect({ company: 'Acme Freight', email: 'kim@landstarmail.com' }), true);
  assert.equal(isBlockedProspect({ company: 'TQL', email: 'bob@tql.com' }), true);
  assert.equal(isBlockedProspect({ company: 'Total Quality Logistics', email: 'bob@x.com' }), true);
  assert.equal(isBlockedProspect({ company: 'Acme Freight', email: 'loads@tql.com' }), true);
  assert.equal(isBlockedProspect({ company: 'Acme Freight', email: 'kim@acme.com' }), false);
});

test('daily check-in email is a simple friendly good-morning note', () => {
  const text = buildDailyCheckInEmail(
    { contact: 'Kevin Presley', email: 'kevin@coolmorelogistics.com' },
    { yourName: 'Daniel', phone: '484-575-6486', email: 'trucks1224@gmail.com' }
  );
  assert.match(text, /^Good morning Kevin,/);
  assert.match(text, /anything I can help you with today/i);
  assert.match(text, /trucks ready and available/i);
  assert.doesNotMatch(text, /double broker/i);
  assert.doesNotMatch(text, /stay on top of our updates/i);
  assert.doesNotMatch(text, /broski/i);
  assert.match(dailyCheckInSubject(), /good morning/i);
});

test('daily check-in is due once a day, only while active', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  const sent = hoursAgo => new Date(now - hoursAgo * 3600000).toISOString();
  assert.equal(isDailyCheckInDue({ active: true, lastSentAt: '' }, now), true);
  assert.equal(isDailyCheckInDue({ active: true, lastSentAt: sent(DAILY_CHECKIN_AFTER_HOURS + 1) }, now), true);
  assert.equal(isDailyCheckInDue({ active: true, lastSentAt: sent(2) }, now), false);
  assert.equal(isDailyCheckInDue({ active: false, lastSentAt: '' }, now), false);
  assert.equal(isDailyCheckInDue({ active: false, lastSentAt: sent(100) }, now), false);
});

test('isLandstarRefusal catches "cannot work with Landstar" replies only', () => {
  assert.equal(isLandstarRefusal("Sorry we can't work with Landstar"), true);
  assert.equal(isLandstarRefusal('We cannot work with Landstar at this time.'), true);
  assert.equal(isLandstarRefusal('We do not work with Landstar.'), true);
  assert.equal(isLandstarRefusal("We don't want to work with Landstar, sorry."), true);
  assert.equal(isLandstarRefusal('Unfortunately we are not able to work with you.'), true);
  assert.equal(isLandstarRefusal('We will not be able to work with Landstar right now.'), true);
  assert.equal(isLandstarRefusal('We no longer work with Landstar agencies.'), true);
  assert.equal(isLandstarRefusal("We can't wait to work with you!"), false);
  assert.equal(isLandstarRefusal('Can you work with us on this lane?'), false);
  assert.equal(isLandstarRefusal('Yes, send rates - we would love to work with you.'), false);
  assert.equal(isLandstarRefusal(''), false);
});

test('decline reply apologizes for other agents and leaves the door open', () => {
  const text = buildDeclineReplyEmail(
    { contact: 'Merlin Comeaux', email: 'merlin@kaglogistics.com' },
    { yourName: 'Daniel', phone: '484-575-6486', email: 'trucks1224@gmail.com' }
  );
  assert.match(text, /^Hello Merlin,/);
  assert.match(text, /I am sorry/);
  assert.match(text, /horrible/i);
  assert.match(text, /let me know right away/i);
  assert.match(text, /do not double broker/i);
  assert.match(text, /Independent Agent for Landstar/);
  assert.doesNotMatch(text, /broski/i);
  assert.match(buildDeclineReplyEmail({}, { yourName: 'D' }), /^Hello,/);
});

test('follow-up is due 1 day after the intro email, only while still "emailed"', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const emailed = { status: 'emailed', emailed_at: '2026-11-05T12:00:00Z' };
  assert.equal(isFollowUpDue(emailed, now), true);
  assert.equal(isFollowUpDue({ ...emailed, emailed_at: '2026-11-08T12:00:00Z' }, now), false);
  assert.equal(isFollowUpDue({ ...emailed, status: 'replied' }, now), false);
  assert.equal(isFollowUpDue({ ...emailed, status: 'new' }, now), false);
  assert.equal(isFollowUpDue({ status: 'emailed' }, now), false);
});
