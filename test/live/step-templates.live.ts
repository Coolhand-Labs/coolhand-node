/**
 * End-to-end proof of `listStepTemplates`/`getStepTemplate` and `includeTurnMetrics` against a REAL
 * Coolhand server. Nothing here is mocked. Opt-in like the other live suites (`npm run test:live`);
 * see templates.live.ts for the shared setup.
 *
 *   COOLHAND_LIVE_BASE_URL=http://127.0.0.1:3111 \
 *   COOLHAND_LIVE_API_KEY=<your private key> \
 *   COOLHAND_LIVE_STEP_TEMPLATE_ID=<id of a published step template> \
 *   COOLHAND_LIVE_TURN_METRICS_LOG_ID=<hashid of a captured-session log> \
 *   npm run test:live
 *
 * Every request is read-only.
 */
import { LoggingService } from '../../src/services/LoggingService';
import { StepTemplateService } from '../../src/services/StepTemplateService';
import { StepTemplate, StepTemplateEfficiencyCohort } from '../../src/types';
import { LIVE_API_KEY, LIVE_BASE_URL } from './env';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Live step template tests need ${name} in the environment.`);
  }
  return value;
}

const STEP_TEMPLATE_ID = Number(requiredEnv('COOLHAND_LIVE_STEP_TEMPLATE_ID'));
const TURN_METRICS_LOG_ID = requiredEnv('COOLHAND_LIVE_TURN_METRICS_LOG_ID');

function newService(key: string = LIVE_API_KEY): StepTemplateService {
  return new StepTemplateService({ apiKey: key, silent: true, baseUrl: LIVE_BASE_URL });
}

function expectNullableNumber(value: unknown): void {
  expect(value === null || typeof value === 'number').toBe(true);
}

function expectStepTemplateShape(row: StepTemplate): void {
  expect(Number.isInteger(row.id)).toBe(true);
  expect(typeof row.name).toBe('string');
  expect(['prompt_step', 'tool_step']).toContain(row.step_type);
  expect(typeof row.status).toBe('string');
  expect(row.user_turn_pattern === null || typeof row.user_turn_pattern === 'string').toBe(true);
  expect(typeof row.created_at).toBe('string');
  expect(typeof row.updated_at).toBe('string');
  expect(Number.isInteger(row.sessions_count)).toBe(true);
  expect(Number.isInteger(row.occurrences_count)).toBe(true);
  expect(row.last_seen_at === null || typeof row.last_seen_at === 'string').toBe(true);
}

function expectCohortShape(cohort: StepTemplateEfficiencyCohort | null): void {
  if (cohort === null) {
    return;
  }
  for (const field of ['runs', 'token_runs'] as const) {
    expect(Number.isInteger(cohort[field])).toBe(true);
  }
  for (const field of ['avg_turns_after', 'avg_tool_calls', 'avg_requests'] as const) {
    expect(typeof cohort[field]).toBe('number');
  }
  expect(typeof cohort.tokens_available).toBe('boolean');
  for (const field of ['median_tokens', 'p90_tokens', 'tokens_per_tool_call'] as const) {
    expectNullableNumber(cohort[field]);
  }
}

function expectMetricsShape(metrics: StepTemplate['metrics']): void {
  expect(metrics).toBeDefined();
  if (!metrics) {
    return;
  }
  expect(Number.isInteger(metrics.total_runs)).toBe(true);
  expect(metrics.tool_stats === null || Array.isArray(metrics.tool_stats)).toBe(true);
  for (const stat of metrics.tool_stats ?? []) {
    expect(typeof stat.name).toBe('string');
    expect(typeof stat.pct_of_runs).toBe('number');
    expect(typeof stat.avg_per_run).toBe('number');
  }
  if (metrics.turn_stats !== null) {
    expect(typeof metrics.turn_stats.avg).toBe('number');
    expect(typeof metrics.turn_stats.median).toBe('number');
    expect(Number.isInteger(metrics.turn_stats.high)).toBe(true);
    expectNullableNumber(metrics.turn_stats.single_turn_pct);
  }
  if (metrics.efficiency !== null) {
    expectCohortShape(metrics.efficiency.interactive);
    expectCohortShape(metrics.efficiency.automated);
    expectCohortShape(metrics.efficiency.all);
    expect(Number.isInteger(metrics.efficiency.unavailable_runs)).toBe(true);
  }
  expect(Array.isArray(metrics.notes)).toBe(true);
  for (const note of metrics.notes) {
    expect(typeof note).toBe('string');
  }
}

describe('StepTemplateService against a live server', () => {
  describe('listStepTemplates', () => {
    it('returns rows without metrics by default, and reads pagination off the response headers', async () => {
      const { stepTemplates, pagination } = await newService().listStepTemplates();

      expect(stepTemplates.length).toBeGreaterThan(0);
      for (const row of stepTemplates) {
        expectStepTemplateShape(row);
        expect(row).not.toHaveProperty('metrics');
      }
      expect(pagination.current_page).toBe(1);
      expect(pagination.per_page).toBe(25);
      expect(pagination.total_count).toBeGreaterThanOrEqual(stepTemplates.length);
    });

    it('adds a typed metrics object per row with includeMetrics, and the server caps per at 25', async () => {
      const { stepTemplates, pagination } = await newService().listStepTemplates({ includeMetrics: true, per: 100 });

      expect(stepTemplates.length).toBeGreaterThan(0);
      for (const row of stepTemplates) {
        expectStepTemplateShape(row);
        expectMetricsShape(row.metrics);
      }
      expect(pagination.per_page).toBe(25);
    });

    it('filters by stepType and search', async () => {
      const service = newService();
      const all = (await service.listStepTemplates()).stepTemplates;
      const type = all[0].step_type;

      const byType = (await service.listStepTemplates({ stepType: type })).stepTemplates;
      expect(byType.length).toBeGreaterThan(0);
      expect(byType.every((row) => row.step_type === type)).toBe(true);

      const bySearch = (await service.listStepTemplates({ search: all[0].name.toUpperCase() })).stepTemplates;
      expect(bySearch.map((row) => row.id)).toContain(all[0].id);

      const none = await service.listStepTemplates({ search: 'zz-no-such-step-template-zz' });
      expect(none.stepTemplates).toEqual([]);
      expect(none.pagination.total_count).toBe(0);
    });

    it('rejects an unknown stepType with 422', async () => {
      await expect(newService().listStepTemplates({ stepType: 'nope' as never })).rejects.toMatchObject({ status: 422 });
    });
  });

  describe('getStepTemplate', () => {
    it('includes metrics by default', async () => {
      const row = await newService().getStepTemplate(STEP_TEMPLATE_ID);

      expectStepTemplateShape(row);
      expect(row.id).toBe(STEP_TEMPLATE_ID);
      expectMetricsShape(row.metrics);
    });

    it('omits metrics with includeMetrics: false', async () => {
      const row = await newService().getStepTemplate(STEP_TEMPLATE_ID, { includeMetrics: false });

      expectStepTemplateShape(row);
      expect(row).not.toHaveProperty('metrics');
    });

    it('404s for an unknown id', async () => {
      await expect(newService().getStepTemplate(2_000_000_000)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('authentication', () => {
    it('rejects an invalid API key with 401 on both endpoints', async () => {
      const service = newService('ch_priv_definitely_not_a_real_key');

      await expect(service.listStepTemplates()).rejects.toMatchObject({ status: 401 });
      await expect(service.getStepTemplate(STEP_TEMPLATE_ID)).rejects.toMatchObject({ status: 401 });
    });
  });
});

describe('LoggingService#getLogContent includeTurnMetrics against a live server', () => {
  const service = new LoggingService({ apiKey: LIVE_API_KEY, silent: true, baseUrl: LIVE_BASE_URL });

  it('omits turn_metrics entirely by default', async () => {
    const log = await service.getLogContent(TURN_METRICS_LOG_ID);

    expect(log).not.toHaveProperty('turn_metrics');
  });

  it('returns a typed turn_metrics array with includeTurnMetrics: true', async () => {
    const log = await service.getLogContent(TURN_METRICS_LOG_ID, { includeTurnMetrics: true });

    expect(Array.isArray(log.turn_metrics)).toBe(true);
    expect(log.turn_metrics?.length).toBeGreaterThan(0);
    for (const turn of log.turn_metrics ?? []) {
      expect(Number.isInteger(turn.index)).toBe(true);
      expect(typeof turn.human).toBe('boolean');
      expect(turn.started_at === null || typeof turn.started_at === 'string').toBe(true);
      expect(turn.ended_at === null || typeof turn.ended_at === 'string').toBe(true);
      expect(Number.isInteger(turn.assistant_requests)).toBe(true);
      expect(Number.isInteger(turn.tool_calls)).toBe(true);
      for (const field of ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_creation_tokens'] as const) {
        expect(turn[field] === null || Number.isInteger(turn[field])).toBe(true);
      }
    }
  });
});
