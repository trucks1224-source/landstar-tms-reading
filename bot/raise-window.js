// Brings the bot's browser window in front of everything else, so a login prompt is
// never hidden behind other windows. page.bringToFront() only switches tabs inside the
// browser; minimizing and re-maximizing the window through Chrome itself is what makes
// Windows put it on top.
async function raiseWindow(page) {
  if (!page) return false;
  await page.bringToFront().catch(() => {});
  let session = null;
  try {
    session = await page.context().newCDPSession(page);
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    await new Promise(resolve => setTimeout(resolve, 150));
    // Back as maximized, never "normal": a narrow window gets Landstar's phone layout,
    // which has no Upload Spreadsheet button, and the bot can't upload.
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
    return true;
  } catch {
    return false;
  } finally {
    if (session) await session.detach().catch(() => {});
  }
}

module.exports = { raiseWindow };
