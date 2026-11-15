import { RealizedSavings } from '../types';
import { BaseService, BaseServiceConfig } from './BaseService.js';

export interface SavingsServiceConfig extends BaseServiceConfig {}

/**
 * Access to `GET /api/v2/savings` — the client's realized savings, a singleton keyed by the
 * authenticating API key (no id, no filters).
 *
 * Requires the client's **private** API key — the public key is rejected exactly like an invalid
 * key. Throws on failure, like the other read services.
 */
export class SavingsService extends BaseService {
  constructor(config: SavingsServiceConfig) {
    super(config, '/api/v2/savings');
  }

  /**
   * Fetch what this client has saved by switching templates or models: what the requests served
   * by the current templates cost, versus what the same requests would have cost on the deprecated
   * versions they replaced. It is the figure the dashboard shows.
   *
   * @returns `{ total, cost_at_previous_versions, percent, workloads }`. A client with nothing to
   *   compare gets zeros and an empty `workloads` array — that is real zero savings. Money values
   *   are USD numbers. Each `workloads[].id` is the workload hashid, the same `id` as
   *   `searchWorkloads`.
   * @throws Error on network failure or a non-JSON body. A non-2xx response throws an
   *   {@link HttpError} whose `status` holds the HTTP status code: `401` for a missing, invalid or
   *   public key, and `503` when the comparison could not be computed right now. A `503` is NOT
   *   zero savings; it is retryable, so never map it to zeros.
   */
  public async getRealizedSavings(): Promise<RealizedSavings> {
    return this.getJson<RealizedSavings>(this.apiEndpoint, 'Savings');
  }
}
