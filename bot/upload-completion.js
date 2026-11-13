async function closeSuccessfulUploadConfirmation(page) {
  const result = await page.waitForFunction(() => {
    const backdrop = document.querySelector('.cdk-overlay-backdrop');
    if (!backdrop) return { state: 'closed' };

    const dialogs = document.querySelectorAll('.cdk-overlay-pane, [role="dialog"]');
    for (const dialog of dialogs) {
      const text = dialog.innerText || '';
      if (!/TMS Loads Upload Complete/i.test(text)) continue;
      const match = text.match(/(\d+)\s+of\s+(\d+)\s+Loads were successfully created/i);
      if (!match || Number(match[1]) === 0 || Number(match[1]) !== Number(match[2])) {
        return { state: 'incomplete', text };
      }
      const button = Array.from(dialog.querySelectorAll('button'))
        .find(item => item.innerText.trim().toLowerCase() === 'done' && !item.disabled);
      if (!button) return { state: 'missing-button' };
      button.click();
      return { state: 'confirmed' };
    }
    return false;
  }, null, { timeout: 60000 });
  const outcome = await result.jsonValue();
  if (outcome.state === 'incomplete') {
    throw new Error(`Landstar did not confirm every load was created: ${outcome.text}`);
  }
  if (outcome.state === 'missing-button') {
    throw new Error('Landstar reported an upload complete, but its Done button was unavailable.');
  }
  await page.waitForFunction(
    () => !document.querySelector('.cdk-overlay-backdrop'),
    null,
    { timeout: 60000 }
  );
}

module.exports = { closeSuccessfulUploadConfirmation };
