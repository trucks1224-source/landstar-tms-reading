// Run this ONCE to save your Landstar login session.
// A browser opens -> you log in yourself -> the session is saved to auth.json
// After that, upload.js reuses it so you never type your password into the bot.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://portal.landstaronline.com/agent/bulk-postings');

  console.log('\n>>> A browser window opened.');
  console.log('>>> Log in to Landstar with your normal User-ID and password.');
  console.log('>>> Wait until you see the Bulk Postings page, then come back here.\n');

  // Wait until the user is fully logged in and on the bulk postings page.
  await page.waitForURL('**/agent/bulk-postings**', { timeout: 300000 });
  // Give the page a moment to finish loading after redirect.
  await page.waitForTimeout(3000);

  await context.storageState({ path: 'auth.json' });
  console.log('>>> Login session saved to auth.json. You can close this and run upload.js now.\n');

  await browser.close();
})().catch(err => {
  console.error('Login capture failed:', err.message);
  process.exit(1);
});
