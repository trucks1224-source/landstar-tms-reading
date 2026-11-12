const LOCK_NAME = 'landstar-driver-broker-email-worker';

export function createEmailWorker({
  tasks, locks, onStatus, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout
}) {
  const jobs = tasks.map(task => ({ ...task, due: Infinity }));
  const issues = new Map();
  let started = false;
  let stopped = false;
  let owner = false;
  let running = null;
  let timer = null;
  let release = null;
  let lastCheckedAt = null;
  let pausedUntil = 0;
  let pauseMessage = '';
  let runHadIssue = false;

  const publish = (state, message) => {
    if (!stopped) onStatus({ state, message, lastCheckedAt, issues: [...issues.values()] });
  };
  const schedule = (callback, delay) => {
    clearTimer(timer);
    timer = setTimer(callback, Math.max(0, delay));
  };
  const reportIssue = (message) => {
    if (!running || stopped) return;
    runHadIssue = true;
    issues.set(running.id, { task: running.label, message: String(message), at: now() });
    const throttled = /quota|rate.?limit|too many requests/i.test(String(message));
    if (throttled) {
      pausedUntil = now() + 60000;
      pauseMessage = `Gmail limit: automatic checks paused until ${new Date(pausedUntil).toLocaleTimeString()}`;
    }
    publish(throttled ? 'blocked' : 'working', throttled ? pauseMessage : running.label);
    return throttled;
  };

  async function tick() {
    if (stopped || !owner || running) return;
    if (now() < pausedUntil) {
      publish('blocked', pauseMessage);
      schedule(() => { void tick(); }, pausedUntil - now());
      return;
    }
    const next = [...jobs].sort((a, b) => a.due - b.due)[0];
    if (!next || next.due > now()) {
      publish(issues.size ? 'blocked' : 'idle', issues.size ? 'Some checks need attention' : 'Waiting for next check');
      if (next) schedule(() => { void tick(); }, next.due - now());
      return;
    }
    running = next;
    runHadIssue = false;
    publish('working', next.label);
    try {
      await next.run();
    } catch (error) {
      console.warn(`Email worker (${next.label}): ${error.message}`);
      reportIssue(error.message || String(error));
    } finally {
      if (!runHadIssue) issues.delete(next.id);
      lastCheckedAt = now();
      next.due = now() + next.every;
      running = null;
      if (stopped) release?.();
      else {
        publish(issues.size ? 'blocked' : 'idle', now() < pausedUntil
          ? pauseMessage : issues.size ? 'Some checks need attention' : 'Waiting for next check');
        schedule(() => { void tick(); }, 0);
      }
    }
  }

  async function acquire() {
    if (stopped) return;
    try {
      await locks.request(LOCK_NAME, { ifAvailable: true }, async lock => {
        if (stopped) return;
        if (!lock) {
          publish('standby', 'Another local TMS tab owns email automation');
          schedule(() => { void acquire(); }, 5000);
          return;
        }
        owner = true;
        for (const job of jobs) job.due = now() + (job.delay || 0);
        publish('idle', 'Starting scheduled checks');
        await new Promise(resolve => {
          release = resolve;
          schedule(() => { void tick(); }, 0);
        });
        owner = false;
      });
    } catch (error) {
      publish('blocked', `Cannot coordinate email automation: ${error.message}`);
      console.error('Email worker ownership failed:', error);
    }
  }

  return {
    start() {
      if (started || stopped) return;
      started = true;
      if (!locks?.request) {
        publish('blocked', 'Browser coordination is unavailable. Open the local TMS in a browser supporting Web Locks.');
        return;
      }
      void acquire();
    },
    isOwner: () => owner && !stopped,
    reportIssue,
    request(id) {
      const job = jobs.find(item => item.id === id);
      if (!job || !owner || stopped) return;
      job.due = Math.min(job.due, now());
      if (!running) schedule(() => { void tick(); }, 0);
    },
    stop() {
      stopped = true;
      clearTimer(timer);
      // Keep ownership until the current job settles, including any send in flight.
      if (!running) release?.();
    }
  };
}

export function describeEmailWorker(status, drafts = []) {
  const failed = drafts.filter(draft => draft.error);
  const approvals = drafts.filter(draft => !draft.error && !draft.sending);
  if (status.state === 'standby' || status.state === 'view-only') return status.message;
  if (failed.length || status.issues?.length || status.state === 'blocked') return 'Email worker: needs attention';
  if (approvals.length) return `Email worker: ${approvals.length} awaiting approval`;
  if (status.state === 'working') return `Email worker: ${status.message}`;
  if (status.state === 'idle') return 'Email worker: on';
  return 'Email worker: starting';
}
