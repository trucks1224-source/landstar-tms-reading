import playwright from "playwright";

export default async function handler(req, res) {
  const { origin, dest, equipment } = req.query;

  const datUrl = `https://iq.dat.com/rateview/${origin}~${dest}~${equipment}`;

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(datUrl, { waitUntil: "networkidle" });

  const rate = await page.$eval(".rateview-rate", el => el.textContent);

  await browser.close();

  res.status(200).json({ rate });
}
