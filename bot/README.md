# Landstar Bulk Upload Bot

Automatically uploads your exported Landstar Excel files to the Landstar Agent
Portal, one at a time, and moves them aside so they are never posted twice.

## One-time setup

1. Install dependencies (already done if `node_modules` exists):
   ```
   npm install
   npx playwright install chromium
   ```
2. That's it. The first time you run the upload, a browser window opens and
   you log in to Landstar yourself. Your login is remembered in the
   `browser-profile` folder, so you only do this once.

## Keep the bot on while you work (recommended)

Double-click **`Start Landstar Bot.bat`** in this folder (or run `npm run watch`).

- A black window and the bot's browser open. Log in to Landstar if asked.
- The TMS header light turns **green** ("Bot logged in").
- Export from the TMS as usual. Within a few seconds of each new
  `Landstar_Bulk_*.xlsx` landing in Downloads, the bot rate-checks it and
  uploads it, then keeps watching.
- It refreshes Landstar every 10 minutes while idle so you stay logged in.
- If a file fails 3 times it is left in Downloads and skipped (the black window
  says why). If the rate check fails, nothing is uploaded and it retries.
- **To turn it off:** close the bot's browser window (or press Ctrl+C in the
  black window). The TMS light goes grey.

Tip: right-click `Start Landstar Bot.bat` → **Send to → Desktop (create shortcut)**
to start it from your desktop.

## Every time you export (one-time run)

1. In the TMS app, click **Export to Landstar Bulk Excel**. The files download
   to your `Downloads` folder as `Landstar_Bulk_<broker>.xlsx`.
2. Run the bot:
   ```
   npm run upload
   ```
3. The bot first checks the Landstar load board for every load (see
   "Rate check" below), then uploads each pending file one at a time, and moves
   finished files into `Downloads\landstar-uploaded\` so they are not resent.

## Bot status light in the TMS

While the bot runs, the TMS header (next to ⚙ My Settings) shows its status:
green **Bot logged in** / **Bot uploading**, yellow **Bot signing in…**, or
grey **Bot off** when no bot is running. The bot shares this only on your own
computer (`http://127.0.0.1:47615/status`, see `status-server.js`). The terminal
also shows a green **LOGGED IN TO LANDSTAR** bar and the bot's browser shows a
green "Bot logged in" badge.

## Duplicate postings (removed automatically after upload)

Re-importing a customer's list and exporting again posts every still-open load
again, and Landstar keeps the older posting live too. About 2 minutes after each
upload (and every 10 minutes while the bot is idle), the bot scans the board for
your bulk-uploaded postings under your own codes (ANQ, SNB), and for any load
posted more than once it **keeps the newest posting and removes the older copies**.
Postings you made by hand are never touched.

- `node dedupe.js` - report only: how many duplicates are live right now.
- `node dedupe.js --apply` - remove them now.
- `node upload.js --watch --no-dedupe` - run the bot without removing duplicates.

## Loads that drop off a customer's list (removed automatically)

When you import a customer's list into the TMS (every customer except Nolan, whose
screenshots only show part of their board), any load that was posted to Landstar and
is no longer on the list is sent to the bot. The bot finds the posting that matches
exactly what was exported (origin ZIP, destination ZIP, pickup end, delivery end,
weight) under your own codes and removes it. Only bulk-uploaded postings are touched.

- Works for loads exported after this feature was added (the TMS saves those details
  at export).
- DAT rate screenshots and screenshots the TMS could not fully read never trigger it.
- If an import would drop more than half of a customer's posted loads, the TMS asks first.
- The queue lives in `unpost-queue.json`; if the bot is off, the TMS keeps it and
  sends it when the bot is back. `node unpost.js` processes the queue once by hand.

## Rate check (runs automatically before upload)

For each load in the spreadsheet, the bot searches the Landstar Available Loads
board for other agencies' postings on the same lane and pickup date:

- Same origin and destination city and state. Landstar's abbreviations and
  county codes (e.g. `ELK GRV VLG [CO]`) are matched to the full city name.
- Same pickup date.
- Same trailer group (VAN, 53VN and 48VN all count as VAN).
- Your own postings are ignored: the load's posting code, plus every code in
  `OWN_POSTING_CODES` at the top of `rate-check.js` (currently ANQ and SNB).
  Add a code there if you start posting under another one.

If anyone else pays the same or more, the load's Rate (and Carrier Amt) is
raised to their highest + $25. If you are already highest, the rate is left
alone. The terminal lists every load with its old rate, new rate and the
posting it beat. There is no cap.

If the board can't be searched (for example, the login times out), nothing is
uploaded. Options:

- `npm run ratecheck` - report only: shows what would change, edits nothing.
- `node upload.js --no-rate-check` - upload at the exported rates, no board check.

## Notes

- Files already in `landstar-uploaded` are skipped, so nothing is double-posted.
- Landstar requires one upload at a time; the bot waits for each to finish.
- To scan a different folder: `node upload.js "C:\path\to\folder"`
- `browser-profile` stores your login. Do not share or commit it.
