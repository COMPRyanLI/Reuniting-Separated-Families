import type { Deps } from '../deps.js';
import { processDueJobs } from './outbox.js';

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

/** Outbox worker loop: drains due jobs, then waits. Errors back off without crashing the process. */
export async function runWorkerLoop(deps: Deps, signal: AbortSignal, extraTick?: () => Promise<void>): Promise<void> {
  let failures = 0;
  while (!signal.aborted) {
    try {
      let n: number;
      do {
        n = await processDueJobs(deps);
      } while (n > 0 && !signal.aborted);
      if (extraTick) await extraTick();
      failures = 0;
    } catch (e) {
      failures++;
      deps.logger.error('worker_iteration_failed', { name: e instanceof Error ? e.name : 'error', failures });
    }
    await sleep(Math.min(60_000, deps.config.workerPollMs * 2 ** Math.min(failures, 5)), signal);
  }
}
