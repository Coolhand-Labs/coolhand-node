import { getGlobalStats } from './global-monitor.js';

export interface InterceptionSnapshot {
  interceptedCalls: number;
}

/**
 * Snapshot coolhand-node's interception counter before making a request, so a later call to
 * {@link assertInterceptionOccurred} can check whether it increased — a bare
 * `interceptedCalls > 0` check can't, since a long-running process will already have a
 * nonzero count from earlier requests.
 *
 * `interceptedCalls` is a single process-wide counter incremented by every intercepted call,
 * not scoped to a URL or request — a delta proves *some* matched request was intercepted in
 * the window between the snapshot and the assertion, not that a specific concurrent request
 * was. If other monitored traffic can occur in that window (parallel requests, retries,
 * unrelated background calls), this can't attribute the increase to one particular call.
 *
 * This mirrors {@link getGlobalStats}, which only tracks the **global monitoring** path
 * (`initializeGlobalMonitoring()` / `coolhand-node/auto-monitor`). It does not observe requests
 * intercepted by an instance-based `new Coolhand({...})` monitor (see README's
 * "Instance-Based Monitoring" option) — that path keeps its own separate counter, returned by
 * `coolhand.getStats().interceptedCalls`, which this snapshot/assert pair does not read.
 */
export function captureInterceptionSnapshot(): InterceptionSnapshot {
  const { interceptedCalls } = getGlobalStats();
  return { interceptedCalls };
}

/**
 * Assert that at least one request was intercepted since `before` was captured. Use this in
 * your own CI to catch the silent-monitoring-bypass failure mode where a client library
 * captures a stale `fetch`/`http.request` reference before `initializeGlobalMonitoring()`
 * runs — the request still succeeds, but coolhand-node never sees it, with no error or
 * warning (see docs/global-monitoring.md troubleshooting items 4 and 5).
 *
 * A failure here doesn't always mean a stale reference: it also fires if the request never
 * matched a configured API pattern, matched an excluded/self pattern, was a non-inference call
 * (e.g. a model-list GET), or was skipped as a duplicate within the dedup window — check
 * `docs/global-monitoring.md` if the request should have matched but didn't. It also fires
 * unconditionally if your app only uses the instance-based `new Coolhand({...})` monitor rather
 * than `initializeGlobalMonitoring()` / `coolhand-node/auto-monitor` — see the scoping note on
 * {@link captureInterceptionSnapshot}.
 */
export function assertInterceptionOccurred(before: InterceptionSnapshot, message?: string): void {
  const after = captureInterceptionSnapshot();
  if (after.interceptedCalls <= before.interceptedCalls) {
    throw new Error(
      message ??
        `Expected coolhand-node to intercept at least one new request, but interceptedCalls did ` +
          `not increase (before: ${before.interceptedCalls}, after: ${after.interceptedCalls}). This can ` +
          `mean a client library captured a stale reference to fetch/http.request before ` +
          `initializeGlobalMonitoring() ran, or that the request didn't match a configured API pattern ` +
          `(or matched an excluded/self pattern, was a non-inference call, or was skipped as a duplicate) — see ` +
          `https://github.com/Coolhand-Labs/coolhand-node/blob/main/docs/global-monitoring.md troubleshooting items 4 and 5.`
    );
  }
}
