import { SearchWorkloadsParams, SearchWorkloadsResponse, WorkloadSummary } from '../types';
import { BaseService, BaseServiceConfig } from './BaseService.js';

export interface WorkloadServiceConfig extends BaseServiceConfig {}

/**
 * Read-only access to `GET /api/v2/workloads`. There is no per-workload endpoint.
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
}
