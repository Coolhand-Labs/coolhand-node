import {
  GetTemplateOptions,
  LlmRequestTemplateDetail,
  LlmRequestTemplateSummary,
  SearchTemplatesParams,
  SearchTemplatesResponse,
  UpsertedTemplate,
  UpsertTemplateParams,
  UpsertTemplateResponse
} from '../types';
import { keyProblem } from '../utils/entity-key.js';
import { BaseService, BaseServiceConfig } from './BaseService.js';

export interface TemplateServiceConfig extends BaseServiceConfig {}

/**
 * Access to `GET /api/v2/llm_request_templates`, `GET /api/v2/llm_request_templates/{id}` and the
 * `PUT /api/v2/llm_request_templates/by_key/*key` upsert.
 *
 * All require the client's **private** API key — the public key is write-only on this API and is
 * rejected exactly like an invalid key. Both throw on failure (the read-method convention shared
 * with `FeedbackService`/`LoggingService`'s read methods), rather than logging and returning
 * `null` the way the write methods do.
 *
 * Beyond the by-key upsert, template *mutation* stays on the MCP surface: this REST surface has no
 * deprecate, and no version-history sub-resource.
 */
export class TemplateService extends BaseService {
  constructor(config: TemplateServiceConfig) {
    super(config, '/api/v2/llm_request_templates');
  }

  /**
   * List templates, optionally filtered. Search is the `search` *parameter* on this list endpoint,
   * not a route of its own — hence one method rather than a separate `listTemplates`/`search` pair.
   *
   * Named `searchTemplates` for symmetry with `searchLogs`/`searchFeedback`, which wrap the same
   * GET-list-with-filters shape. It is **not** a port of the `search_templates` MCP tool and does
   * not match it: `log_count` here excludes evals and synthetic logs, and templates on archived
   * workloads are returned rather than hidden.
   *
   * @param params Named filters plus `page`/`per`. There is no `clientId` — the client is derived
   *   from the API key and cannot be supplied.
   * @returns `{ templates, pagination }`. The endpoint renders `templates` as a bare array on the
   *   wire and always sends `X-Page`/`X-Per-Page`/`X-Total-Count`/`X-Total-Pages`, which
   *   `pagination` is read from — it is never computed from the array length. Results are newest
   *   first (`created_at DESC`, primary-key tiebreaker, so paging is stable).
   * @throws Error on network failure, a non-JSON body, or an invalid `since`/`until` `Date`. A
   *   non-2xx response throws an {@link HttpError} whose `status` holds the HTTP status code: `401`
   *   for a missing/invalid/public key, `422` for an unrecognized `status`, an undecodable/foreign
   *   `workloadId`, or a malformed/inverted metrics window (only checked with `includeMetrics`), and
   *   `504` when the `log_count` aggregate exceeds the backend's 10-second statement timeout.
   *   A `504` here is an expected, retryable condition rather than a bug — narrow the query with
   *   `workloadId`, `search`, or a smaller `per` and try again.
   */
  public async searchTemplates(params: SearchTemplatesParams = {}): Promise<SearchTemplatesResponse> {
    const url = new URL(this.apiEndpoint);

    this.setQueryParams(url, {
      search: params.search,
      workload_id: params.workloadId,
      status: params.status,
      include_deprecated: params.includeDeprecated,
      include_system: params.includeSystem,
      include_metrics: params.includeMetrics,
      days_back: params.daysBack,
      since: this.toTimestampParam(params.since, 'since'),
      until: this.toTimestampParam(params.until, 'until'),
      page: params.page,
      per: params.per
    });

    const { body, headers } = await this.getJsonWithHeaders<LlmRequestTemplateSummary[]>(
      url.toString(),
      'Template'
    );
    return { templates: body, pagination: this.paginationFromHeaders(headers, body, params) };
  }

  /**
   * Get a single template by hashid, including `user_prompt_pattern`/`system_prompt_pattern` —
   * the full untruncated regexes {@link searchTemplates} omits.
   *
   * Unlike the list, this applies no filtering beyond client ownership: a deprecated or system
   * template is reachable by id with no opt-in flag, since inspecting one of those is the usual
   * reason to fetch a template directly.
   *
   * Includes `metrics` by default, unlike {@link searchTemplates} where it is opt-in; pass
   * `includeMetrics: false` to omit it (which also skips window validation).
   *
   * @param id The template hashid, i.e. the `id` field from {@link searchTemplates}.
   * @param opts `includeMetrics` (default true) and the metrics window: `daysBack`, or `since`/`until` (explicit wins).
   * @throws Error if `id` is blank/whitespace-only or a bare dot-segment (`.`/`..`) — either would
   *   otherwise silently resolve away to the `index` route, returning a bare array typed as a
   *   single template. Error on network failure or a non-JSON body. A non-2xx response throws an
   *   {@link HttpError} whose `status` holds the HTTP status code: `422` for a malformed/inverted metrics window, `404` for an unknown id *or*
   *   one belonging to another client (existence is not disclosed, so this is never a `403`), and
   *   `504` on the same `log_count` timeout described on {@link searchTemplates} — fetching the
   *   `Unmatched` bucket by id counts every log that never matched a template.
   */
  public async getTemplate(id: string, opts: GetTemplateOptions = {}): Promise<LlmRequestTemplateDetail> {
    const url = this.buildResourceUrl(id, 'getTemplate: id must be a non-empty string');
    this.setQueryParams(url, {
      include_metrics: opts.includeMetrics,
      days_back: opts.daysBack,
      since: this.toTimestampParam(opts.since, 'since'),
      until: this.toTimestampParam(opts.until, 'until')
    });
    return this.getJson<LlmRequestTemplateDetail>(url.toString(), 'Template');
  }

  /**
   * Create or update a template by its stable `key` (`PUT /api/v2/llm_request_templates/by_key/*key`).
   * Requires the **private** API key.
   *
   * Only the fields you pass are sent. The key is immutable; a new `name` renames the template.
   * `workload` names the owning workload as `{ id }` or `{ key }` (`id` wins if both are somehow
   * present) and is flattened to the endpoint's `workload_id` / `workload_key` params. It is
   * required when creating.
   *
   * @returns `{ template, created }` — `created` is `true` for a new template (201), `false` for an
   *   update (200). Resolves to `null` on a dry run (nothing is sent).
   * @throws Error if `key` is blank or has an empty/`.`/`..` segment, or `workload` has neither a
   *   non-blank `id` nor `key` (before any request), or on network failure or a non-JSON body. A
   *   non-2xx response throws an {@link HttpError} whose `status` holds the HTTP status code: `401`
   *   for a missing/invalid/public key, `422` for a taken name, a missing workload when creating, a
   *   different workload for an existing template, or a key held by a deprecated template.
   */
  public async upsert(params: UpsertTemplateParams): Promise<UpsertTemplateResponse | null> {
    const body: Record<string, unknown> = {};
    if (params.name !== undefined) { body.name = params.name; }
    if (params.reporter !== undefined) { body.reporter = params.reporter; }
    if (params.workload !== undefined) {
      if (typeof params.workload !== 'object' || params.workload === null) {
        throw new Error('Template upsert: workload must be { id } or { key } with a non-blank string');
      }
      // `in` checks (not property reads) so a loosely-typed JS caller passing `{}` is rejected below.
      const id: unknown = 'id' in params.workload ? params.workload.id : undefined;
      const key: unknown = 'key' in params.workload ? params.workload.key : undefined;
      if (typeof id === 'string' && id.trim() !== '') {
        body.workload_id = id;
      } else if (typeof key === 'string' && key.trim() !== '') {
        const problem = keyProblem(key);
        if (problem) { throw new Error(`Template upsert: workload key ${problem} (got: "${key}")`); }
        body.workload_key = key;
      } else {
        throw new Error('Template upsert: workload must be { id } or { key } with a non-blank string');
      }
    }

    const result = await this.putByKey<UpsertedTemplate>(params.key, body, 'Template');
    return result && { template: result.record, created: result.created };
  }
}
