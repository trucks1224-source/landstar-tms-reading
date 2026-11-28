// Customer screenshots read by Claude (Daniel 2026-11-27, customer rules step 2): for a customer
// whose ⚙ Rules say how to read their screenshots, the TMS sends the picture(s) and those words
// here; Claude returns every load row in the TMS's fields. Needs ANTHROPIC_API_KEY in .env (or an
// `ant auth login` profile) on this computer. Used by vite.config.js /api/read-screenshot.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';

const ScreenshotLoad = z.object({
  loadId: z.string().describe('The load / order / reference number exactly as shown; empty if none'),
  equipment: z.string().describe('Equipment as written (Van, Reefer, Flatbed, VZ, 53 Dry Van...); empty if not shown'),
  origCity: z.string(),
  origState: z.string().describe('Two-letter state or province code'),
  origZip: z.string(),
  destCity: z.string(),
  destState: z.string().describe('Two-letter state or province code'),
  destZip: z.string(),
  pickupFrom: z.string().describe('Earliest pickup as MM/DD/YYYY HHMM (24-hour); empty if not shown'),
  pickupTo: z.string().describe('Latest pickup as MM/DD/YYYY HHMM (24-hour); empty if not shown'),
  deliveryFrom: z.string().describe('Earliest delivery as MM/DD/YYYY HHMM (24-hour); empty if not shown'),
  deliveryTo: z.string().describe('Latest delivery as MM/DD/YYYY HHMM (24-hour); empty if not shown'),
  weight: z.string().describe('Weight in pounds, digits only; empty if not shown'),
  miles: z.string().describe('Miles, digits only; empty if not shown'),
  rate: z.string().describe("The customer's rate in dollars, digits only; empty if not shown"),
  onHold: z.boolean().describe('True only when the customer marks the load as on hold / not ready'),
  hazmat: z.boolean(),
  notes: z.string().describe('Anything else on the row worth keeping (commodity, comments); empty if nothing')
});
const ScreenshotLoads = z.object({
  loads: z.array(ScreenshotLoad),
  unreadable: z.string().describe('Rows or parts you could not read, in a few words; empty if everything was readable')
});

const SYSTEM = [
  "You read freight load lists from a trucking customer's screenshot for a load-board TMS.",
  'Return every load row in the picture(s), in order, once each (pictures of the same list may overlap: list a load once).',
  'Copy values exactly as shown; never invent a value that is not in the picture - leave the field empty instead.',
  'Dates: use the year shown, or the current year when none is shown. Times are 24-hour HHMM.',
  "Follow the customer's own instructions below; they explain this customer's layout."
].join(' ');

export async function readScreenshotLoads({ images = [], instructions = '', customer = '', today = new Date() } = {}) {
  if (!images.length) return { status: 400, body: { error: 'No picture was sent.' } };
  const client = new Anthropic();
  const content = [
    ...images.slice(0, 6).map(image => ({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType || 'image/png', data: String(image.data || '') }
    })),
    {
      type: 'text',
      text: `Customer: ${customer || 'unknown'}\nToday: ${today.toLocaleDateString('en-US')}\n\nHow to read this customer's screenshots:\n${String(instructions || '').trim() || '(no special instructions)'}\n\nList every load.`
    }
  ];
  try {
    const response = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: 'medium', format: betaZodOutputFormat(ScreenshotLoads) },
      messages: [{ role: 'user', content }]
    });
    if (response.stop_reason === 'refusal') {
      return { status: 422, body: { error: 'Claude declined to read this picture. Import it another way.' } };
    }
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
      return { status: 422, body: { error: 'The picture had more rows than could be read at once. Import it in smaller screenshots.' } };
    }
    return { status: 200, body: response.parsed_output };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return { status: 401, body: { error: 'No AI key on this computer: add ANTHROPIC_API_KEY to the TMS .env file (see How to install), then restart the TMS.' } };
    }
    if (error instanceof Anthropic.RateLimitError) {
      return { status: 429, body: { error: 'The AI is busy right now. Try the import again in a minute.' } };
    }
    if (error instanceof Anthropic.APIError) {
      return { status: 502, body: { error: `The AI could not read the picture (${error.status}): ${error.message}` } };
    }
    if (/api key|apiKey|authentication/i.test(String(error?.message))) {
      return { status: 401, body: { error: 'No AI key on this computer: add ANTHROPIC_API_KEY to the TMS .env file, then restart the TMS.' } };
    }
    throw error;
  }
}
