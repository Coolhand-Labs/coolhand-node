import {
  LlmRequestTemplateDetail,
  LlmRequestTemplateSummary,
  SearchTemplatesParams,
  SearchTemplatesResponse
} from '../types';
import { BaseService, BaseServiceConfig } from './BaseService.js';

export interface TemplateServiceConfig extends BaseServiceConfig {}

/**
 * Read-only access to `GET /api/v2/llm_request_templates` and
 * `GET /api/v2/llm_request_templates/{id}`.
 *
 * Both require the client's **private** API key — the public key is write-only on this API and is
 * rejected exactly like an invalid key. Both throw on failure (the read-method convention shared
 * with `FeedbackService`/`LoggingService`'s read methods), rather than logging and returning
 * `null` the way the write methods do.
 *
 * Template *mutation* stays on the MCP surface: this REST surface has no create/update/deprecate,
 * and no version-history sub-resource.
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
   * @throws Error on network failure or a non-JSON body. A non-2xx response throws an
   *   {@link HttpError} whose `status` holds the HTTP status code: `401` for a missing/invalid/
   *   public key, `422` for an unrecognized `status` or an undecodable/foreign `workloadId`, and
   *   `504` when the `log_count` aggregate exceeds the backend's 10-second statement timeout.
   *   A `504` here is an expected, retryable condition rather than a bug — narrow the query with
   *   `workloadId`, `search`, or a smaller `per` and try again.
   */
  public async searchTemplates(params: SearchTemplatesParams = {}): Promise<SearchTemplatesResponse> {
    const url = new URL(this.apiEndpoint);

    const queryParams = {
      search: params.search,
      workload_id: params.workloadId,
      status: params.status,
      include_deprecated: params.includeDeprecated,
      include_system: params.includeSystem,
      page: params.page,
      per: params.per
    };
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

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
   * @param id The template hashid, i.e. the `id` field from {@link searchTemplates}.
   * @throws Error if `id` is blank/whitespace-only or a bare dot-segment (`.`/`..`) — either would
   *   otherwise silently resolve away to the `index` route, returning a bare array typed as a
   *   single template. Error on network failure or a non-JSON body. A non-2xx response throws an
   *   {@link HttpError} whose `status` holds the HTTP status code: `404` for an unknown id *or*
   *   one belonging to another client (existence is not disclosed, so this is never a `403`), and
   *   `504` on the same `log_count` timeout described on {@link searchTemplates} — fetching the
   *   `Unmatched` bucket by id counts every log that never matched a template.
   */
  public async getTemplate(id: string): Promise<LlmRequestTemplateDetail> {
    const url = this.buildResourceUrl(id, 'getTemplate: id must be a non-empty string');
    return this.getJson<LlmRequestTemplateDetail>(url.toString(), 'Template');
  }
}
