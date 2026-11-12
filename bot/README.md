# Landstar Bulk Upload Bot

Automatically uploads your exported Landstar Excel files to the Landstar Agent
Portal, one at a time, and moves them aside so they are never posted twice.

## One-time setup

Straight-truck exports use **D-ST** as primary and **D-LG** as acceptable alternate
when no liftgate is required. Set equipment to **D-LG** when a liftgate is required;
those exports have no D-ST alternate. The legacy combined `D-LG,D-ST` value means
either is acceptable and exports D-ST first.
The load editor provides primary equipment and two optional alternate dropdowns.
Alternates mean any listed equipment is acceptable; they export to Landstar's
Equipment 2 and Equipment 3 columns. Select None to remove an automatic alternate.
Changing primary equipment resets alternates to that equipment's defaults.
**D-RF - Straight truck reefer** is available as primary or alternate equipment
and exports unchanged; no dry-truck alternate is automatically added.

1. Install dependencies (already done if `node_modules` exists):
   ```
   npm install
   npx playwright install chromium
   ```
2. That's it. The first time you run the upload, a browser window opens and
   you log in to Landstar yourself. Your login is remembered in the
   `browser-profile` folder, so you only do this once.

## Keep the bot on while you work (recommended)

In the local TMS, **Pause all local bots** pauses posting, helper, rate and
removal workers on that computer after their current task completes. Their
browser windows remain open; the watchdog does not restart them while paused.
**Resume local bots** allows them to continue, but does not override the
separate automatic-posting policy or clear any upload-review error. Start
Everything must be running to restart missing workers. The setting is stored
on that computer only and is not shared with teammates. Browser-based email
automation is separate and is not controlled by this switch.

Entering a driver's phone number in the TMS moves an unbooked load to the
**OFFER** folder (also when picking a saved driver fills the phone number).
The **OFFER** tab shows offers and their customer names across all customers.
Opening an offer selects its owning customer; selection, copy, move and delete
can span all visible customers. Search and lane filters still apply.
The pickup-date filter has a full-width Open calendar button, 48-pixel controls,
and Today/Tomorrow shortcuts using the computer's local date. Clicking anywhere
in the date field opens its calendar in supported browsers. You can still type a
date directly; All dates clears only that date filter.

Before preparing or sending a POD request or reminder, the TMS checks the driver's
BCO email threads and separate exact-freight-bill `Load# ...` emails from the
driver on the selected dispatch for paperwork already attached, including replies
sent before delivery was recorded. Unmatched senders and other load numbers are
not accepted as standalone paperwork. Received paperwork cancels pending POD requests; a failed
Gmail check blocks the request instead of assuming no paperwork was received.
For Paramount and RXO, received POD files are automatically reply-all forwarded
on the existing exact-order customer thread, without a first-send approval gate.
RXO uses an update-request conversation when available, otherwise a human
rate-confirmation conversation. No-reply-only messages are not forwarding targets.
Missing threads and send failures remain visible in the email panel; the load is
not marked sent until Gmail confirms the send.
An identical file already sent by the connected account on the selected customer
chain is not resent, including manual forwards; filename and size alone do not
count as a match.

Prospect outreach excludes Nolan Transportation Group (NTG), alongside Landstar
agencies and TQL. This covers new outreach, follow-ups, daily prospect check-ins
and automatic prospect replies, including queued/manual sends. This restriction
does not disable booked-load updates to Nolan.

Editing an order number updates the existing load in place, preserving its
booking and details. A number already used in the same customer is rejected.
**Add Load** opens a blank manual load without an order-number prompt. It
clears list filters and opens the load editor so the new load is not hidden by a
search, pickup date or another folder. Until an
order is entered, a unique internal `MANUAL-...` reference keeps loads separate;
Landstar bulk export does not require the customer order number.
Origin and destination city fields suggest US city/state pairs after two
characters. Selecting one fills its state and a representative ZIP, which should
be verified against the facility address. Entering a known ZIP fills city/state.
With pickup and delivery city/state present, mileage fills automatically using
Google Routes city-to-city routing without requiring or using ZIPs. If Google is
unavailable and valid ZIPs exist, a clearly labeled ZIP-based estimate is used.
Otherwise a visible notice asks for manual mileage. Changing locations
clears automatic mileage so it can recalculate; manually entered miles are kept.
The editable Commodity selector supports CGAPP, HAZMAT and CHEM, or Automatic
equipment-based classification. Manual choices survive imports and copies and
control the exported commodity and hazmat attributes. Removing a hazmat
classification requires explicit confirmation.

Remove capacity returns a load to OPEN and protects it like a hand-added load:
later imports keep it even when the customer omits it. Missing-list posting
cleanup and exported-load expiration also leave it alone; delete it explicitly
when it is no longer available. Removing capacity does not automatically repost it.

Booked Loads are ordered by pickup date and time, earliest first, with missing
pickup schedules last. Completed loads remain in their separate section; search
opens the global load list across all customers and statuses, including completed
booked loads. Selected pickup date, pickup state and delivery state filters narrow
search results; status, rate and mileage filters are ignored during search.
Clearing search restores the existing filters. Bulk export remains
limited to the selected customer.
In OFFER, Select All and individual checkboxes span all visible customers.
Selections use customer plus load number, so identical numbers in different
customer folders stay distinct. Copy, move and delete act on those selections;
Landstar export remains restricted to the currently opened customer.

Submitting **Log check call** queues the entered note and reported stage for a
customer reply-all update. The local email worker sends it on or after pickup
day; older check calls and stage-dropdown changes are not emailed retroactively.
The saved pending flag survives reloads. Exact-order customer chain checks,
SNB-only Ivan copies, visible send failures and Gmail check-call markers prevent
cross-order updates and duplicate retries. RXO check calls go to the rate
confirmation first and separately to matching update-request conversations.
If no exact-order RXO customer chain exists, customer updates and driver paperwork
start a separate order-specific conversation with **Dashawn.Cook@rxo.com**.
Later updates/paperwork reuse that conversation. Existing RXO chains take
precedence; other customers still require an existing chain. SNB-only Ivan
copy rules and paperwork attachment duplicate checks remain in effect.

**Important loads / replacement capacity:** Remove capacity returns a load to OPEN,
marks it IMPORTANT / NEEDS CAPACITY, clears the previous driver's tracking/email
state, and protects it from replacement imports and missing-list posting removal.
Manual loads, booked loads, and loads marked Needs capacity are protected from
missing-list removal; protected postings are also excluded from general duplicate
cleanup. Important loads appear first in the main load list. Booking clears Needs
capacity and stops refresh requests.

The local posting worker attempts to refresh important OPEN/ENT loads every
15 minutes while the local TMS supplies a fresh protection snapshot. OFFER,
BOOKED, ON HOLD, truck-assigned and expired-pickup loads are not refreshed.
Export each important load once with its current details to establish the refresh
source; changing its details requires another export. Refresh preserves the last
uploaded workbook and current board rate. For safety, the replacement is uploaded
and verified **before** removing the old posting, so a failed upload cannot take
the load off the board. An interrupted submission is never automatically resent.
Bulk error drafts, missing source files, ambiguous matches and removal failures
appear as TMS warnings. The posting bot must be restarted after updating its code.
This is a local Landstar posting feature, not the proposed cloud email worker.

Automatic posting can be explicitly paused with
`"automaticPostingEnabled": false` in `automation-policy.json`. The uploader
refuses new uploads and refreshes, and the watchdog does not restart it.
Pending exports can be moved into a separate holding subfolder in Downloads;
the uploader only watches the top-level Downloads folder. Do not move held files
back when starting fresh unless those old exports are intentionally wanted.
After explicit confirmation to remove **all own available postings**, including
manual/protected postings, run `node take-down-all.js --confirm-all-own-postings`
with the posting worker stopped. This manual-only command verifies the board
after cancellation; it does not edit TMS records or booked shipments.

The shared Vercel website does not host Posting, Helper, Rates or Removals
workers and cannot start them on another computer. Its bot indicator states this
instead of reporting a local worker as off. Local Start bot requests reject a
paused posting policy rather than opening a window that immediately exits.

Daily customer updates run locally after 9 AM, once per day for booked loads
that have picked up and have not delivered. The TMS must remain open and the
tracking check must be no more than 30 minutes old with a known truck location.
Updates reply-all on an existing exact-order customer chain, never a new email.
Generic customers also require a customer-name match and a single unambiguous
thread. Missing chains and Gmail failures appear in the email panel. Gmail
message headers and saved sent dates prevent repeating a daily update after reload.
The initial Paramount broker tracking-link introduction may be prepared before
pickup day when a verified link is available, subject to existing approval rules.
The initial driver paperwork-receipt confirmation can send before pickup day
once the booked load has a matching BCO freight bill. It asks the driver to
confirm receipt and activate tracking on pickup day, not immediately.
Subsequent driver emails, automatic status follow-ups, tracking-app reminders and
check-call alerts start on the pickup calendar day in the TMS computer's local
time. Future pickups do not show overdue tracking/check-call warnings. Check-call
age starts no earlier than pickup-day midnight, not the earlier booking date.
Missing pickup schedules block automatic follow-ups until corrected. Manual check
calls remain available; received paperwork processing is unchanged.
Driver email tracking instructions say to turn on the app **on the day of pickup**,
not immediately when receiving the email, and keep it tracking through delivery.
For RXO only, daily and driver-status updates prefer the exact-order **Update
Request** thread. If none is available, they use that same load's **Rate
Confirmation** thread, reply-all. Unrelated order emails are
not fallback targets; other customers' thread rules are unchanged.
RXO ATZ, ATZ P and ATZ V booked loads participate in RXO tracking and update-request
replies, including exact-order matching and the same recipient safeguards.
Ivan is copied on customer load emails **only for posting code SNB**. Non-SNB
and unknown-code loads exclude him from To/Cc, even if an earlier thread included
him. The load's posting-code override takes priority over the profile default,
and pending drafts recheck the current code when sent.
For matched booked SNB loads, RXO Update Requests receive an automatic reply-all
with Ivan copied and whatever shipment information is available. Missing ETA,
location or tracking link does not hold the reply for approval. Unknown status
and ETA are explicitly described as unconfirmed; a loaded truck is not assumed
to have departed. Non-SNB reply approval rules are unchanged. Separate Ivan-only
forwards are disabled, including previously queued forwarding drafts.

On the existing two-minute driver-reply poll, explicit driver confirmations of
arrival at the shipper, loading, departure or delivery automatically trigger a
reply-all update on the matching order's existing customer conversation. These
updates do not require Clarity, a tracking link or first-send approval. "Loaded"
does not imply departure or invent an ETA. Only the newest confirmed status from
the last 24 hours is caught up; quoted text, questions and uncertain wording do
not trigger a confirmation. Exact-order/customer matching and recipient safeguards
are the same as daily updates. Gmail message markers prevent replay after reload;
failed sends remain visible and retry on the next poll. The local TMS must stay open.
Concurrent Gmail reads share a 30-second cache, cleared after sends. Quota errors
pause Gmail requests for at least 60 seconds (or its longer Retry-After value);
the normal polls retry afterward instead of continuously hitting the quota.
Requests are spaced at least half a second apart, and driver-reply polls do not
overlap if Gmail is slow.

The first worker-separation stage is the **driver-to-broker email worker** in the
local TMS. Its header status expands to show the current check, last completed
check, missing-load/thread errors, Gmail failures and pending approvals. Polling
jobs run one at a time instead of overlapping timers; a failed check does not
cancel other jobs. Tracking-triggered broker emails use that same schedule.
Web Locks permit only one local TMS tab to run automatic email checks. Other tabs
show standby and take over after the owner closes; an in-flight job keeps the
lock until it settles. Without Web Locks, automatic email checks stop with an
explicit error instead of risking duplicate sends. Existing approval rules,
SNB-only recipient routing and Gmail sent-message markers are unchanged.
Gmail quota/rate-limit failures pause the coordinated checks for at least one
minute instead of immediately checking every other load against the same limit.
Keep the local TMS open: this is not yet a standalone background email service.
Posting/helper/removal processes run separately from these browser email checks.
No new rate increases are authorized.

This does not assign capacity or send an offer to the customer. Use **Book Load**
after acceptance. Already-booked loads stay booked when their phone is edited.
Exports and reimports of the same load/day preserve OFFER status; use **OPEN**
to move an offer back manually.

Booking automation is **Assign Capacity only**. After booking in the TMS, the bot
processes the assignment queue under an exclusive worker lock. Before clicking
Assign it permanently records the posting number in `assign-queue.json.attempts/`.
A repeated attempt for that posting or customer order is blocked, even after a
timeout, repost, truck change, or restart.
Do not delete these records to retry without checking Landstar first. A worker
crash leaves an assignment lock requiring manual review before clearing.

After booking in the TMS, the bot
assigns the truck on Landstar; dispatch, MercuryGate entries and confirmation uploads
are manual. Driver tracking/receipt-confirmation/pickup-ETA follow-up emails remain
enabled independently, on the BCO Load Detail thread once the booked load has a
freight bill. The first three driver emails still require approval; sent follow-ups
are not repeated. Gmail must be connected. Automatic dispatch is disabled in
`automation-policy.json` at both the TMS and worker/API entry points. Existing
tracking/update emails, uploads, and queued board removals are unchanged.

Double-click **`Start Rate Worker.bat`** and **`Start Landstar Bot.bat`** in this
folder (or run `npm run rates` and `npm run watch` in separate terminals here).

- A black window and the bot's browser open. Log in to Landstar if asked.
- The TMS header light turns **green** ("Bot logged in").
- Export from the TMS as usual. Within a few seconds of each new
  `Landstar_Bulk_*.xlsx` landing in Downloads, the rate worker prepares it and
  the posting worker uploads it, then keeps watching.
- It refreshes Landstar every 10 minutes while idle so you stay logged in.
- Before each submission the bot checks Landstar's bulk error queue. Errors or
  an unavailable check pause uploads rather than submitting more files.
- A file is moved to `Downloads\landstar-upload-review\` before it is attached.
  If submission times out, is rejected, or the bot stops midway, it stays there
  and is never automatically resent, including after a restart. Further uploads
  pause, but tracking and queued removals can continue.
- Check the file's actual Landstar postings and error drafts before moving it
  out of review. Do not put an entire partially accepted file back in Downloads;
  export only the confirmed missing loads. A finished upload with no errors
  currently reported moves to `landstar-uploaded`; this is not proof every load
  is live, since Landstar may report processing errors later.
- Restart the upload bot once to enable these safeguards. They do not bypass
  duplicate warnings, delete active postings, or guarantee Landstar accepts
  every export.
- **To turn it off:** close the bot's browser window (or press Ctrl+C in the
  black window). The TMS light goes grey.

Tip: right-click `Start Landstar Bot.bat` → **Send to → Desktop (create shortcut)**
to start it from your desktop.

## Dedicated rate worker

The rate worker uses a separate persistent browser profile
(`browser-profile-rates`). Sign in to Landstar in that window if asked.
Its **Rate worker** indicator can start it and shows login, working, blocked and
idle states even if the posting worker is off. The watchdog also keeps it running.

The standard posting/helper launchers now pass `--dedicated-rates`. Restart those
workers only when idle, not during submission or capacity assignment. Until both
have switched modes, the rate worker explicitly waits instead of competing with
legacy workers. The helper no longer rate-checks exports, leaving it available
for capacity/tracking. Posting waits for prepared files and never falls back to
unchecked uploads when the rate worker is off or its login fails.

Every file is exclusively owned during rate preparation and posting. A checked
file's SHA-256, size and timestamp must still match immediately before reservation
for upload. If the file changes it must be checked again. A lock belonging to a
live process never expires mid-check. Locks with unknown owners (including old
empty helper locks) require review; only locks whose PID is confirmed dead are
recovered automatically. All-empty exports are archived without overwriting
earlier skipped exports; failed checks do not publish a ready marker.

This moves existing **Landstar board competitor checks**, including the existing
30-minute hazmat check, out of posting. It does not change pricing rules, intervals,
account scope, caps or dispatch policy. DAT API rate quotes still run in the TMS;
this is not a new DAT load-posting integration. `--no-hazmat-watch` on the rate
worker disables its recurring hazmat checks if needed. The legacy one-time
`node upload.js` path remains available, with exclusive export ownership.

## Dedicated removal bot

The TMS search box searches all customers and statuses, including booked and
archived loads. While text search is active, date, state, rate and mileage filters
are ignored; clearing the search restores the normal filters.

Booking a load queues Landstar Assign Capacity using its saved export details.
If those details are missing, the TMS reconstructs the export match from both ZIPs,
pickup/delivery end times and weight. The helper only uses a recovered match when
it also matches a spreadsheet in `Downloads\landstar-uploaded`; otherwise it reports
the unmatched posting instead of assigning an unrelated load. Successful assignment
restores the posting details in the TMS. Durable assignment reservations still prevent
automatic retries after an uncertain submission; automatic dispatch stays separate.

Double-click **`Start Removal Bot.bat`** to run a third bot in its own browser
profile (`browser-profile-removal`). Sign in to Landstar in that window if asked.
It processes only `unpost-queue.json`, using the existing posting-matching rules;
it never compares or clears the entire board. Importing a full customer list into
the TMS automatically queues that customer's previously exported postings missing
from the list, including Paramount. Manual entries, booked loads and NEEDS CAPACITY
loads remain protected. RXO equipment-specific lists only affect those categories;
DAT and incomplete screenshot imports do not trigger missing-list removals.
An import removing more than 10 postings and over half the customer's postings
still requires confirmation; background imports skip such large removals.
The worker cancels one posting at a time and checks the board afterward. Postings
still present remain queued for retry instead of being reported as removed.

Restart the upload bot once after installing this change. While the removal bot
is running, the upload bot leaves queued removals to it. When it is off, the upload
bot continues handling removals as before. The watchdog also restarts the removal
bot. Close the watchdog first if you intentionally want to stop a bot.

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
