const test = require('node:test');
const assert = require('node:assert/strict');
const { planAlerts, buildAlertEmail, chatWaitingProblem, unconfirmedProblem, LASTS_MS, GAP_MS, RESEND_MS } = require('./alerts');

const NOW = Date.parse('2026-11-27T20:00:00');
const stuck = { key: 'chat-stuck-1', level: 'bad', title: "Google Chat bot can't read the chats (failing for 12 min)", detail: 'Look at the Chat bot window.' };
const signIn = { key: 'upload-signin-2', level: 'bad', title: 'Upload bot needs the Landstar sign-in', detail: '' };

test('a problem is emailed once it has lasted 5 minutes, once, grouped, at most every 10 minutes', () => {
  let { send, state } = planAlerts([stuck], {}, NOW);
  assert.deepEqual(send, [], 'just appeared: wait');
  ({ send, state } = planAlerts([stuck], state, NOW + LASTS_MS));
  assert.deepEqual(send.map(problem => problem.key), ['chat-stuck-1']);
  ({ send, state } = planAlerts([stuck], state, NOW + LASTS_MS + 60000));
  assert.deepEqual(send, [], 'already emailed');
  ({ send, state } = planAlerts([stuck, signIn], state, NOW + LASTS_MS + 2 * 60000));
  assert.deepEqual(send, [], 'a new problem waits its own 5 minutes');
  ({ send, state } = planAlerts([stuck, signIn], state, NOW + LASTS_MS + 7 * 60000));
  assert.deepEqual(send, [], 'but no second email within 10 minutes');
  ({ send, state } = planAlerts([stuck, signIn], state, NOW + LASTS_MS + GAP_MS));
  assert.deepEqual(send.map(problem => problem.key), ['upload-signin-2']);
  ({ send, state } = planAlerts([stuck, signIn], state, NOW + LASTS_MS + RESEND_MS));
  assert.deepEqual(send.map(problem => problem.key), ['chat-stuck-1'], 'still there after 4 hours: reminded');
  ({ send, state } = planAlerts([], state, NOW + LASTS_MS + RESEND_MS + 60000));
  assert.deepEqual(state.seen, {}, 'fixed problems are forgotten');
});

test('the email says what is wrong in plain words', () => {
  const { subject, text } = buildAlertEmail([stuck, signIn], NOW);
  assert.match(subject, /TMS needs you: 2 things/);
  assert.match(text, /\[!\] Google Chat bot can't read the chats/);
  assert.match(text, /Upload bot needs the Landstar sign-in/);
  assert.match(buildAlertEmail([signIn], NOW).subject, /^TMS needs you: Upload bot needs the Landstar sign-in$/);
});

test('chat files waiting over 15 minutes are one problem', () => {
  const items = [
    { name: 'a.png', type: 'picture', chat: 'Para lists', savedAt: NOW - 20 * 60000 },
    { name: 'b.xlsx', type: 'spreadsheet', chat: 'LANDJA18 (RXO)', label: 'new list', savedAt: NOW - 16 * 60000 },
    { name: 'c.xlsx', type: 'spreadsheet', chat: 'LANDJA18 (RXO)', label: 'big list', savedAt: NOW - 60000 }
  ];
  const problem = chatWaitingProblem(items, NOW);
  assert.match(problem.title, /^2 Google Chat files waiting for you \(oldest 20 min\)$/);
  assert.equal(chatWaitingProblem(items.slice(2), NOW), null);
});

test('loads the TMS marks NOT CONFIRMED are one problem; a stale report is ignored', () => {
  const report = { at: NOW - 60000, loads: [
    { customer: 'R X O 2429200 - VAN', id: '24780975', route: 'GLENDALE, AZ -> ALBANY, OR' },
    { customer: 'Para 1522166 - HAZ', id: '2291338', route: '' }
  ] };
  const problem = unconfirmedProblem(report, NOW);
  assert.equal(problem.title, '2 loads exported 3+ hours ago never reached Landstar');
  assert.match(problem.detail, /R X O 2429200 - VAN #24780975 \(GLENDALE, AZ -> ALBANY, OR\)/);
  assert.equal(unconfirmedProblem({ ...report, at: NOW - 31 * 60000 }, NOW), null, 'the TMS tab stopped reporting');
  assert.equal(unconfirmedProblem({ at: NOW, loads: [] }, NOW), null);
});
