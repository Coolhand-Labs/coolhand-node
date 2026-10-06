/**
 * End-to-end proof of `searchLogs`/`getLogContent` — the cost-report filters and per-log `cost` —
 * against a REAL Coolhand server. Nothing here is mocked.
 *
 * Run it with `npm run test:live` (see `templates.live.ts` for why it is not part of `npm test`).
 * Every request is read-only.
 */
import { LoggingService } from '../../src/services/LoggingService';
import { LlmRequestLogSummary } from '../../src/types';
import { LIVE_API_KEY, LIVE_BASE_URL } from './env';

function newService(key: string = LIVE_API_KEY): LoggingService {
  return new LoggingService({ apiKey: key, silent: true, baseUrl: LIVE_BASE_URL });
}

function priced(logs: LlmRequestLogSummary[]): number[] {
  return logs.map((log) => {
    expect(typeof log.cost).toBe('number');
    return log.cost as number;
  });
}

describe('LoggingService cost filters against a live server', () => {
  describe('searchLogs', () => {
    it('returns a bare array whose rows carry cost as a number or null', async () => {
      const { logs } = await newService().searchLogs({ per: 5 });

      expect(Array.isArray(logs)).toBe(true);
      for (const log of logs) {
        expect(typeof log.id).toBe('string');
        expect(log).toHaveProperty('cost');
        expect(log.cost === null || typeof log.cost === 'number').toBe(true);
        expect(typeof log.metadata).toBe('object');
        expect(typeof log.ingest_evidence).toBe('object');
      }
    });

    it('orders by cost descending with order: cost_desc, priceable logs only', async () => {
      const { logs } = await newService().searchLogs({ order: 'cost_desc', per: 10 });

      const costs = priced(logs);
      expect(costs).toEqual([...costs].sort((a, b) => b - a));
    });

    it('keeps only logs at or above minCost', async () => {
      const top = await newService().searchLogs({ order: 'cost_desc', per: 5 });
      if (top.logs.length === 0) {
        throw new Error('Live fixture broken: no priceable log in the local database.');
      }
      const threshold = priced(top.logs)[0];

      const { logs } = await newService().searchLogs({ minCost: threshold, per: 25 });

      expect(logs.length).toBeGreaterThan(0);
      for (const cost of priced(logs)) {
        expect(cost).toBeGreaterThanOrEqual(threshold);
      }
    });

    it('bounds created_at with since/until, which replace daysBack', async () => {
      const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

      const { logs } = await newService().searchLogs({ since: future, daysBack: 7 });

      expect(logs).toEqual([]);
    });

    it('accepts a "+" offset in a string bound — it is encoded, not read as a space', async () => {
      const { logs } = await newService().searchLogs({
        since: '2026-01-01T02:00:00+02:00',
        until: '2026-01-01T03:00:00+02:00',
        per: 1
      });

      expect(Array.isArray(logs)).toBe(true);
    });

    it('rejects a malformed since with 422', async () => {
      await expect(newService().searchLogs({ since: 'bad' })).rejects.toMatchObject({ name: 'HttpError', status: 422 });
    });

    it('rejects a since that is not before until with 422', async () => {
      await expect(
        newService().searchLogs({ since: new Date('2026-10-01T00:00:00Z'), until: new Date('2026-09-01T00:00:00Z') })
      ).rejects.toMatchObject({ status: 422 });
    });

    it('rejects a negative minCost with 422', async () => {
      await expect(newService().searchLogs({ minCost: -1 })).rejects.toMatchObject({ status: 422 });
    });

    it('rejects an unknown order with 422', async () => {
      await expect(newService().searchLogs({ order: 'nope' as never })).rejects.toMatchObject({ status: 422 });
    });
  });

  describe('getLogContent', () => {
    it('returns cost and cost_breakdown for a priced log', async () => {
      const { logs } = await newService().searchLogs({ order: 'cost_desc', per: 1 });
      if (logs.length === 0) {
        throw new Error('Live fixture broken: no priceable log in the local database.');
      }

      const log = await newService().getLogContent(logs[0].id, { section: 'beginning', maxChars: 200 });

      expect(log.id).toBe(logs[0].id);
      expect(log.cost).toBe(logs[0].cost);
      expect(log.cost_breakdown).not.toBeNull();
      expect(typeof log.cost_breakdown?.total_cost).toBe('number');
    });
  });

  describe('authentication', () => {
    it('rejects a request with no API key', async () => {
      await expect(newService('').searchLogs()).rejects.toMatchObject({ status: 401 });
    });

    it('rejects a request with an invalid API key', async () => {
      await expect(newService('ch_priv_definitely_not_a_real_key').searchLogs()).rejects.toMatchObject({
        status: 401
      });
    });
  });
});
