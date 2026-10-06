import { LlmMetrics } from '../../src/types';

// Asserts the types in the API definition, so a nullable field that goes non-null (or the reverse)
// fails here rather than silently in a caller.
export function expectMetricsShape(metrics: LlmMetrics | undefined): asserts metrics is LlmMetrics {
  expect(metrics).toBeDefined();
  if (!metrics) {
    return;
  }
  for (const field of [
    'request_count', 'failure_count', 'priced_request_count', 'long_context_request_count',
    'total_input_tokens', 'total_output_tokens'
  ] as const) {
    expect(Number.isInteger(metrics[field])).toBe(true);
  }
  for (const field of [
    'error_rate', 'error_rate_change', 'avg_cost_per_request', 'total_cost', 'avg_input_tokens',
    'avg_output_tokens', 'avg_latency_ms', 'correctness_score', 'sentiment_score', 'revision_score'
  ] as const) {
    expect(metrics[field] === null || typeof metrics[field] === 'number').toBe(true);
  }
  expect(typeof metrics.since).toBe('string');
  expect(typeof metrics.until).toBe('string');
  expect(metrics.days_back === null || Number.isInteger(metrics.days_back)).toBe(true);
}
