/**
 * End-to-end proof of `getRealizedSavings` against a REAL Coolhand server. Nothing here is mocked —
 * every assertion is about a response that actually came off the wire. It asserts shape and
 * invariants, never the demo database's figures, and every request is read-only.
 *
 * Run it with `npm run test:live` (see `templates.live.ts` for why it is not part of `npm test`).
 */
import { SavingsService } from '../../src/services/SavingsService';
import { WorkloadService } from '../../src/services/WorkloadService';
import { RealizedSavings, WorkloadSavings } from '../../src/types';
import { LIVE_API_KEY, LIVE_BASE_URL } from './env';

function newService(key: string = LIVE_API_KEY): SavingsService {
  return new SavingsService({ apiKey: key, silent: true, baseUrl: LIVE_BASE_URL });
}

function expectWorkloadRowShape(row: WorkloadSavings): void {
  expect(Object.keys(row).sort()).toEqual(['active_requests', 'cost_at_previous_versions', 'id', 'name', 'savings']);
  expect(typeof row.id).toBe('string');
  expect(row.id.length).toBeGreaterThan(0);
  expect(typeof row.name).toBe('string');
  expect(typeof row.savings).toBe('number');
  expect(typeof row.cost_at_previous_versions).toBe('number');
  expect(Number.isInteger(row.active_requests)).toBe(true);
}

describe('SavingsService against a live server', () => {
  describe('getRealizedSavings', () => {
    it('returns the total, baseline, percent and per-workload breakdown as numbers', async () => {
      const savings: RealizedSavings = await newService().getRealizedSavings();

      expect(Object.keys(savings).sort()).toEqual(['cost_at_previous_versions', 'percent', 'total', 'workloads']);
      expect(typeof savings.total).toBe('number');
      expect(typeof savings.cost_at_previous_versions).toBe('number');
      expect(typeof savings.percent).toBe('number');
      expect(Array.isArray(savings.workloads)).toBe(true);
      savings.workloads.forEach(expectWorkloadRowShape);
    });

    it('keeps the saving within its baseline, and percent consistent with them', async () => {
      const { total, cost_at_previous_versions: baseline, percent } = await newService().getRealizedSavings();

      expect(total).toBeLessThanOrEqual(baseline);
      expect(percent).toBeCloseTo(baseline > 0 ? (total / baseline) * 100 : 0, 0);
    });

    it('keys workload rows on the same hashid as searchWorkloads, so they join', async () => {
      const { workloads: rows } = await newService().getRealizedSavings();
      const { workloads, pagination } = await new WorkloadService({
        apiKey: LIVE_API_KEY,
        silent: true,
        baseUrl: LIVE_BASE_URL
      }).searchWorkloads({ includeMetrics: true, daysBack: 28, includeArchived: true, includeSystem: true, per: 100 });

      // One page is enough only while the client has at most 100 workloads (the demo one has 4).
      expect(pagination.has_next_page).toBe(false);
      const ids = new Set(workloads.map((workload) => workload.id));
      for (const row of rows) {
        expect(ids.has(row.id)).toBe(true);
      }
    });
  });

  describe('authentication', () => {
    // The SDK refuses to be constructed without a key, so the server's own answer is read directly.
    it('is rejected by the server with 401 when no key is sent', async () => {
      const response = await fetch(`${LIVE_BASE_URL}/api/v2/savings`, { headers: { Accept: 'application/json' } });

      expect(response.status).toBe(401);
    });

    it('rejects a request with an invalid API key', async () => {
      await expect(newService('ch_priv_definitely_not_a_real_key').getRealizedSavings()).rejects.toMatchObject({
        status: 401
      });
    });
  });
});
