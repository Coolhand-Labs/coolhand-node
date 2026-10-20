import {
  SearchWorkloadsParams,
  SearchWorkloadsResponse,
  UpsertedWorkload,
  UpsertWorkloadParams,
  UpsertWorkloadResponse,
  WorkloadSummary
} from '../types';
import { descriptionProblem } from '../utils/entity-key.js';
import { BaseService, BaseServiceConfig } from './BaseService.js';

export interface WorkloadServiceConfig extends BaseServiceConfig {}

/**
 * Access to `GET /api/v2/workloads` (read-only; there is no per-workload endpoint) and the
 * `PUT /api/v2/workloads/by_key/*key` upsert.
 *
 * Requires the client's **private** API key — the public key is write-only on this API and is
 * rejected exactly like an invalid key. Throws on failure, like the other read services.
 */
export class WorkloadService extends BaseService {
  constructor(config: WorkloadServiceConfig) {
    super(config, '/api/v2/workloads');
  }

  /**
   * List workloads, optionally with a cost/performance `metrics` rollup across each workload's
   * templates (`includeMetrics`), computed by the same SQL as the dashboard.
   *
   * @param params Named filters, the metrics window (`daysBack` or `since`/`until`) and
   *   `page`/`per`. There is no `clientId` — the client is derived from the API key.
   * @returns `{ workloads, pagination }`, ordered by name. Each `id` is the workload hashid.
   *   `pagination` is read from the `X-Page`/`X-Per-Page`/`X-Total-Count`/`X-Total-Pages` headers
   *   the endpoint always sends, never computed from the array length.
   * @throws Error on network failure, a non-JSON body, or an invalid `since`/`until` `Date`. A
   *   non-2xx response throws an {@link HttpError} whose `status` holds the HTTP status code:
   *   `401` for a missing/invalid/public key, `422` for a malformed or inverted `since`/`until`,
   *   a window over 365 days, or a bad `daysBack` (body `{ errors: { <field>: [msg] } }`), and
   *   `504` when an aggregate exceeds the statement timeout — retryable by narrowing with
   *   `search` or a smaller `per`.
   */
  public async searchWorkloads(params: SearchWorkloadsParams = {}): Promise<SearchWorkloadsResponse> {
    const url = new URL(this.apiEndpoint);
    this.setQueryParams(url, {
      search: params.search,
      include_archived: params.includeArchived,
      include_system: params.includeSystem,
      include_templates: params.includeTemplates,
      include_metrics: params.includeMetrics,
      days_back: params.daysBack,
      since: this.toTimestampParam(params.since, 'since'),
      until: this.toTimestampParam(params.until, 'until'),
      page: params.page,
      per: params.per
    });

    const { body, headers } = await this.getJsonWithHeaders<WorkloadSummary[]>(url.toString(), 'Workload');
    return { workloads: body, pagination: this.paginationFromHeaders(headers, body, params) };
  }

  /**
   * Create or update a workload by its stable `key` (`PUT /api/v2/workloads/by_key/*key`). Requires
   * the **private** API key.
   *
   * Only the fields you pass are sent, so an update changes only what you send. The key is
   * immutable; a new `name` renames the workload. Use this to name a workload ahead of the calls
   * that declare it with `withContext`.
   *
   * @returns `{ workload, created }` — `created` is `true` for a new workload (201), `false` for
   *   an update (200). Resolves to `null` on a dry run (nothing is sent).
   * @throws Error if `key` is invalid or `description` is over 1000 characters (before any request), or on
   *   network failure or a non-JSON body. A non-2xx response throws an {@link HttpError} whose
   *   `status` holds the HTTP status code: `401` for a missing/invalid/public key, `422` for a
   *   taken name or an invalid key/description.
   */
  public async upsert(params: UpsertWorkloadParams): Promise<UpsertWorkloadResponse | null> {
    const body: Record<string, unknown> = {};
    if (params.name !== undefined) { body.name = params.name; }
    if (params.description !== undefined) {
      // Array.from(non-string) would report length 0 and let a number/object through to the server.
      if (typeof params.description !== 'string') { throw new Error('Workload upsert: description must be a string'); }
      const problem = descriptionProblem(params.description);
      if (problem) { throw new Error(`Workload upsert: description ${problem}`); }
      body.description = params.description;
    }
    if (params.reporter !== undefined) { body.reporter = params.reporter; }

    const result = await this.putByKey<UpsertedWorkload>(params.key, body, 'Workload');
    return result && { workload: result.record, created: result.created };
  }
}
