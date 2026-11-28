const test = require('node:test');
const assert = require('node:assert/strict');
const { accountFromFile, parseUploadLog, parseRatesLog, findProblems } = require('./today');

const day = '2026-11-27';
const at = (h, m, s = 0) => new Date(2026, 10, 27, h, m, s).getTime();

test('export file names turn back into account names', () => {
  assert.deepEqual(accountFromFile('Landstar_Bulk_R_X_O_2429200___ATZ_P_1of2__1.xlsx'), { name: 'R X O 2429200 - ATZ P', key: 'RXO2429200ATZP' });
  assert.equal(accountFromFile('Landstar_Bulk_R_X_O_2429200___ATZ_R.xlsx').name, 'R X O 2429200 - ATZ R');
  assert.equal(accountFromFile('Landstar_Bulk_CH_593772__ATZ_H____2.xlsx').key, 'CH593772ATZH');
  assert.equal(accountFromFile('Landstar_Bulk_AMERI_18347__ATZ (1).xlsx').key, 'AMERI18347ATZ');
  assert.equal(accountFromFile('Landstar_Bulk_Square_2570577__ATZ.xlsx').key, 'SQUARE2570577ATZ');
});

// Lines as the upload bot wrote them on 2026-11-27.
const uploadLog = [
  '[09:20:41]   Uploading: Landstar_Bulk_R_X_O_2429200___ATZ_R.xlsx',
  '[09:21:12]   Done: Landstar_Bulk_R_X_O_2429200___ATZ_R.xlsx',
  '[10:35:00]   Uploading: Landstar_Bulk_CH_593772__ATZ_H____2.xlsx',
  "[10:35:31] ERROR [10:35 AM] Uploads stopped: Landstar's upload window did not open (no file input). The file was NOT sent.",
  '[10:37:00]   Uploading: Landstar_Bulk_CH_593772__ATZ_H____2.xlsx',
  "[10:37:09] ERROR [10:37 AM] Uploads stopped: Landstar's upload window did not open (no file input). The file was NOT sent."
].join('\n');

test('upload log: posted files and failures with their account', () => {
  const events = parseUploadLog(uploadLog, day);
  assert.equal(events.length, 3);
  assert.deepEqual([events[0].ok, events[0].account.name, events[0].at], [true, 'R X O 2429200 - ATZ R', at(9, 21, 12)]);
  assert.equal(events[1].ok, false);
  assert.equal(events[1].account.key, 'CH593772ATZH');
  assert.match(events[1].message, /upload window did not open/);
  const unknown = parseUploadLog("[09:18:36] ERROR   ! Submission outcome unknown: Landstar never showed the upload result. Check C:\\Users\\x\\file.xlsx on Landstar", day)[0];
  assert.equal(unknown.unknown, true);
  assert.doesNotMatch(unknown.message, /Check C:/);
});

test('uploads failing for 3+ minutes is a red problem; a later success clears it', () => {
  const events = parseUploadLog(uploadLog, day);
  assert.equal(findProblems({ uploads: events, now: at(10, 36) }).length, 0, 'one failure a minute ago: not yet');
  const problems = findProblems({ uploads: events, now: at(10, 40) });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].level, 'bad');
  assert.match(problems[0].title, /failing \(2 in a row since 10:35 AM\)/);
  assert.equal(problems[0].go, 'upload', 'clicking it brings up the upload bot');
  const recovered = parseUploadLog(`${uploadLog}\n[10:57:54]   Done: Landstar_Bulk_CH_593772__ATZ_H____2.xlsx`, day);
  assert.equal(findProblems({ uploads: recovered, now: at(11, 0) }).length, 0);
});

test('waiting for the Landstar sign-in is a problem right away', () => {
  // As the bot writes it: the message on the line after the time.
  const signIn = parseUploadLog('[08:40:40] \n>>> ACTION NEEDED: A browser window is open on the Landstar login page.', day);
  assert.equal(signIn.length, 1);
  assert.equal(signIn[0].at, at(8, 40, 40), 'the time of the line above');
  assert.match(findProblems({ uploads: signIn, now: at(8, 41) })[0].title, /Landstar sign-in/);
  const after = parseUploadLog('[08:40:40] >>> ACTION NEEDED: A browser window is open on the Landstar login page.\n[08:41:45] [8:41 AM] Logged in. Waiting for exports...', day);
  assert.equal(findProblems({ uploads: after, now: at(8, 42) }).length, 0);
});

test('reviews, bots that are down and the Chat bot sign-in are problems', () => {
  const problems = findProblems({
    reviews: [{ file: 'Landstar_Bulk_R_X_O_2429200___ATZ_P_1of2.xlsx', account: accountFromFile('Landstar_Bulk_R_X_O_2429200___ATZ_P_1of2.xlsx') }],
    health: { rows: [{ id: 'helper', label: 'Helper bot', level: 'bad', detail: 'Not running', fix: 'Start the watchdog' }, { id: 'tms', label: 'TMS server', level: 'ok', detail: 'Running' }, { id: 'restart', label: 'PC restart', level: 'info', detail: 'x' }] },
    chatBot: { state: 'signing-in', pid: 1, message: 'Waiting for Google sign-in' }
  });
  assert.deepEqual(problems.map(problem => problem.level), ['warn', 'bad', 'warn']);
  assert.deepEqual(problems.map(problem => problem.go), ['review-folder', 'helper', 'chatbot'], 'each one opens where the problem is');
  assert.match(problems[0].title, /1 upload to check on Landstar/);
  assert.match(problems[0].detail, /R X O 2429200 - ATZ P/);
  assert.match(problems[1].title, /Helper bot: Not running/);
  assert.match(problems[2].title, /Google Chat bot needs the Google sign-in/);
});

test('rate-check log: loads checked, raised and skipped per account', () => {
  const rates = parseRatesLog([
    '[09:04:07] Rate check: Landstar_Bulk_R_X_O_2429200___ATZ_H.xlsx',
    '[09:04:09]   row 2: Sauk City, WI -> Midland, TX on 11/30/2026  $4168 -> $5525  (top: DYB $5500)',
    '[09:04:09]   row 3: Columbus, WI -> Elmendorf, TX on 12/02/2026  $4676  (already highest; next SHI $4500)',
    '[09:04:14]   row 14: Columbus, NE -> Cape Girardeau, MO on 11/30/2026  SKIPPED - already posted by ATZ (#190794725, $2345)'
  ].join('\n'));
  const atzH = rates.RXO2429200ATZH;
  assert.deepEqual([atzH.checked, atzH.raised, atzH.skippedAtz], [3, 1, 1]);
  assert.deepEqual({ ...atzH.raises[0] }, { lane: 'Sauk City, WI -> Midland, TX', from: 4168, to: 5525, agency: 'DYB' });
});

test('a Chat bot whose checks keep failing shows as stuck after 10 minutes, even while "running"', () => {
  const now = Date.parse('2026-11-27T16:50:00');
  const stuck = { state: 'running', message: 'Last check failed: Target page, context or browser has been closed', failingSince: now - 11 * 60 * 1000 };
  const problems = findProblems({ chatBot: stuck, now });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].level, 'bad');
  assert.match(problems[0].title, /can't read the chats \(failing for 11 min\)/);
  assert.equal(findProblems({ chatBot: { ...stuck, failingSince: now - 5 * 60 * 1000 }, now }).length, 0, 'a short hiccup is not shown');
  assert.equal(findProblems({ chatBot: { state: 'running', message: 'Watching', failingSince: 0 }, now }).length, 0);
});
