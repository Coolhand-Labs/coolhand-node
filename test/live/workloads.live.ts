/**
 * End-to-end proof of `searchWorkloads` against a REAL Coolhand server. Nothing here is mocked —
 * every assertion is about a response that actually came off the wire.
 *
 * Run it with `npm run test:live` (see `templates.live.ts` for why it is not part of `npm test`).
 * Every request is read-only.
 */
import { WorkloadService } from '../../src/services/WorkloadService';
import { LlmMetrics, WorkloadSummary } from '../../src/types';
import { LIVE_API_KEY, LIVE_BASE_URL } from './env';
import { expectMetricsShape } from './shapes';

function newService(key: string = LIVE_API_KEY): WorkloadService {
  return new WorkloadService({ apiKey: key, silent: true, baseUrl: LIVE_BASE_URL });
}

function expectWorkloadShape(workload: WorkloadSummary): void {
  expect(typeof workload.id).toBe('string');
  expect(workload.id.length).toBeGreaterThan(0);
  expect(typeof workload.name).toBe('string');
  expect(typeof workload.archived).toBe('boolean');
  expect(typeof workload.system).toBe('boolean');
  expect(typeof workload.merged).toBe('boolean');
  expect(Number.isInteger(workload.template_count)).toBe(true);
  expect(Number.isInteger(workload.draft_template_count)).toBe(true);
  expect(Number.isInteger(workload.log_count)).toBe(true);
  expect(workload.last_activity === null || typeof workload.last_activity === 'string').toBe(true);
  expect(workload.description === null || typeof workload.description === 'string').toBe(true);
}

describe('WorkloadService against a live server', () => {
  describe('searchWorkloads', () => {
    it('lists workloads by hashid and reads pagination off the response headers', async () => {
      const { workloads, pagination } = await newService().searchWorkloads({ per: 2 });

      expect(workloads.length).toBeGreaterThan(0);
      expect(workloads.length).toBeLessThanOrEqual(2);
      for (const workload of workloads) {
        expectWorkloadShape(workload);
        expect(workload).not.toHaveProperty('metrics');
        expect(workload).not.toHaveProperty('templates');
      }
      expect(pagination.per_page).toBe(2);
      expect(pagination.current_page).toBe(1);
      expect(pagination.total_count).toBeGreaterThanOrEqual(workloads.length);
    });

    it('returns metrics over a rolling window with includeMetrics and daysBack', async () => {
      const { workloads } = await newService().searchWorkloads({ includeMetrics: true, daysBack: 7, per: 2 });

      expect(workloads.length).toBeGreaterThan(0);
      for (const workload of workloads) {
        expect(workload.metrics).toBeDefined();
        expectMetricsShape(workload.metrics as LlmMetrics);
        expect(workload.metrics?.days_back).toBe(7);
      }
    });

    it('lets an explicit since win over daysBack, which then comes back null', async () => {
      const { workloads } = await newService().searchWorkloads({
        includeMetrics: true,
        daysBack: 7,
        since: new Date('2026-09-01T00:00:00Z'),
        until: new Date('2026-10-01T00:00:00Z'),
        per: 1
      });

      const metrics = workloads[0].metrics as LlmMetrics;
      expectMetricsShape(metrics);
      expect(metrics.days_back).toBeNull();
      expect(metrics.since).toBe('2026-09-01T00:00:00Z');
      expect(metrics.until).toBe('2026-10-01T00:00:00Z');
    });

    it('survives a "+" UTC offset in a string bound — it is encoded, not read as a space', async () => {
      const { workloads } = await newService().searchWorkloads({
        includeMetrics: true,
        since: '2026-09-01T02:00:00+02:00',
        until: '2026-10-01T00:00:00Z',
        per: 1
      });

      expect(workloads[0].metrics?.since).toBe('2026-09-01T00:00:00Z');
    });

    it('rejects a malformed since with 422 and the error on the since key', async () => {
      const error = await newService()
        .searchWorkloads({ includeMetrics: true, since: 'bad' })
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ name: 'HttpError', status: 422 });
      expect((error as Error).message).toContain('"since"');
    });

    it('rejects a since that is not before until with 422', async () => {
      await expect(
        newService().searchWorkloads({
          includeMetrics: true,
          since: new Date('2026-10-01T00:00:00Z'),
          until: new Date('2026-09-01T00:00:00Z')
        })
      ).rejects.toMatchObject({ status: 422 });
    });
  });

  describe('authentication', () => {
    it('rejects a request with no API key', async () => {
      await expect(newService('').searchWorkloads()).rejects.toMatchObject({ status: 401 });
    });

    it('rejects a request with an invalid API key', async () => {
      await expect(newService('ch_priv_definitely_not_a_real_key').searchWorkloads()).rejects.toMatchObject({
        status: 401
      });
    });
  });
});
