// Gmail allows only so many API calls per minute. When the TMS hits that limit, an email
// send fails with "Quota exceeded ..." (or the server's own "Gmail quota limit reached ...
// paused briefly" while it waits out the limit). Those sends never reached Gmail, so they
// are safe to try again once the minute is over.

export const GMAIL_QUOTA_WAIT_MS = 65_000;
export const GMAIL_QUOTA_RETRIES = 3;
export const GMAIL_SEND_GAP_MS = 3_000;

export function isGmailQuotaError(error) {
  const message = String(error?.message || error || '');
  return error?.status === 429
    || /quota exceeded|gmail quota limit reached|userRateLimitExceeded|rate limit exceeded|too many requests/i.test(message);
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Runs send(); on a Gmail quota error waits and tries again (up to `retries` more times).
// onWait(secondsLeft, attempt) lets the screen say "Gmail busy — retrying in 65 s".
export async function withGmailQuotaRetry(send, {
  retries = GMAIL_QUOTA_RETRIES, waitMs = GMAIL_QUOTA_WAIT_MS, onWait = () => {}, sleep = wait
} = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (error) {
      if (attempt >= retries || !isGmailQuotaError(error)) throw error;
      onWait(Math.round(waitMs / 1000), attempt + 1);
      await sleep(waitMs);
    }
  }
}

// Keeps outgoing emails a few seconds apart so a batch doesn't use up Gmail's minute at once.
export function createSendSpacer({ gapMs = GMAIL_SEND_GAP_MS, now = () => Date.now(), sleep = wait } = {}) {
  let nextAt = 0;
  let chain = Promise.resolve();
  return function spaced(send) {
    const run = chain.then(async () => {
      const delay = nextAt - now();
      if (delay > 0) await sleep(delay);
      try {
        return await send();
      } finally {
        nextAt = now() + gapMs;
      }
    });
    chain = run.catch(() => {});
    return run;
  };
}
