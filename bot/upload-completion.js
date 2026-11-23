// Waits for Landstar's own result window after a file is sent: "TMS Loads Upload Complete"
// (every load created; Done is clicked) or "... Partially Complete" (some loads became error
// drafts; returned so the draft check can file it for review).
//
// No result window on screen is NOT success. Landstar keeps a file's loads as hidden drafts
// while it posts them; the result window comes only when it is finished. On 11/23 the bot took
// "no window yet" as done, moved to the next file and reloaded Bulk Postings, and Landstar left
// 224 good loads (9 files) as unposted drafts - the "226 Errors" on Bulk Postings.
const RESULT_TIMEOUT_MS = 3 * 60 * 1000;

async function closeSuccessfulUploadConfirmation(page, { timeout = RESULT_TIMEOUT_MS } = {}) {
  let result;
  try {
    result = await page.waitForFunction(() => {
      const dialogs = document.querySelectorAll('.cdk-overlay-pane, [role="dialog"]');
      for (const dialog of dialogs) {
        const text = dialog.innerText || '';
        if (/TMS Loads Upload Partially Complete/i.test(text)) return { state: 'partial', text };
        if (!/TMS Loads Upload Complete/i.test(text)) continue;
        const match = text.match(/(\d+)\s+of\s+(\d+)\s+Loads were successfully created/i);
        if (!match || Number(match[1]) === 0 || Number(match[1]) !== Number(match[2])) {
          return { state: 'incomplete', text };
        }
        const button = Array.from(dialog.querySelectorAll('button'))
          .find(item => item.innerText.trim().toLowerCase() === 'done' && !item.disabled);
        if (!button) return { state: 'missing-button' };
        button.click();
        return { state: 'confirmed', created: Number(match[1]) };
      }
      return false;
    }, null, { timeout });
  } catch (error) {
    if (!/timeout|timed out/i.test(error.message)) throw error;
    throw new Error(`Landstar never showed the upload result (Complete / Partially Complete) within ${Math.round(timeout / 1000)} seconds; its loads may still be unposted drafts.`);
  }
  const outcome = await result.jsonValue();
  if (outcome.state === 'incomplete') {
    throw new Error(`Landstar did not confirm every load was created: ${outcome.text}`);
  }
  if (outcome.state === 'missing-button') {
    throw new Error('Landstar reported an upload complete, but its Done button was unavailable.');
  }
  if (outcome.state === 'partial') return outcome;
  await page.waitForFunction(
    () => !document.querySelector('.cdk-overlay-backdrop'),
    null,
    { timeout: 60000 }
  );
  return outcome;
}

module.exports = { closeSuccessfulUploadConfirmation, RESULT_TIMEOUT_MS };
