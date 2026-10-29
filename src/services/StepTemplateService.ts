import {
  GetStepTemplateOptions,
  ListStepTemplatesParams,
  ListStepTemplatesResponse,
  StepTemplate
} from '../types';
import { BaseService, BaseServiceConfig } from './BaseService.js';

export interface StepTemplateServiceConfig extends BaseServiceConfig {}

/**
 * Read access to `GET /api/v2/step_templates` and `GET /api/v2/step_templates/{id}` — the skills
 * and other recurring steps Coolhand detects in captured agent sessions. There are no write
 * endpoints.
 *
 * Both require the client's **private** API key; the public key is rejected with a `401`. Both
 * throw on failure, like the other read services, rather than resolving to `null`.
 */
export class StepTemplateService extends BaseService {
  constructor(config: StepTemplateServiceConfig) {
    super(config, '/api/v2/step_templates');
  }

  /**
   * List the client's published step templates, newest first.
   *
   * @param params Named filters plus `page`/`per`. There is no `clientId` — the client is derived
   *   from the API key. `includeMetrics` adds a `metrics` object per row and makes the server cap
   *   `per` at 25.
   * @returns `{ stepTemplates, pagination }`. The endpoint renders a bare array and always sends
   *   the `X-Page`/`X-Per-Page`/`X-Total-Count`/`X-Total-Pages` headers `pagination` is read from.
   * @throws Error on network failure or a non-JSON body. A non-2xx response throws an
   *   {@link HttpError} whose `status` holds the HTTP status code: `401` for a missing/invalid/public
   *   key, `422` for a `stepType` other than `prompt_step`/`tool_step`, and `504` when a query
   *   exceeds the statement timeout (retryable — narrow with `search` or a smaller `per`).
   */
  public async listStepTemplates(params: ListStepTemplatesParams = {}): Promise<ListStepTemplatesResponse> {
    const url = new URL(this.apiEndpoint);

    this.setQueryParams(url, {
      search: params.search,
      step_type: params.stepType,
      include_metrics: params.includeMetrics,
      page: params.page,
      per: params.per
    });

    const { body, headers } = await this.getJsonWithHeaders<StepTemplate[]>(url.toString(), 'Step template');
    return { stepTemplates: body, pagination: this.paginationFromHeaders(headers, body, params) };
  }

  /**
   * Get one published step template by id. Includes `metrics` by default, unlike
   * {@link listStepTemplates}; pass `includeMetrics: false` to skip the metrics queries.
   *
   * @param id The integer `id` from {@link listStepTemplates}.
   * @throws Error if `id` is not a positive integer, on network failure, or on a non-JSON body. A
   *   non-2xx response throws an {@link HttpError} whose `status` holds the HTTP status code: `401`
   *   for a missing/invalid/public key, `404` for an unknown id, a draft or failed step template, or
   *   one belonging to another client (existence is not disclosed), and `504` on a statement timeout.
   */
  public async getStepTemplate(id: number, opts: GetStepTemplateOptions = {}): Promise<StepTemplate> {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error('getStepTemplate: id must be a positive integer');
    }
    const url = new URL(`${this.apiEndpoint}/${id}`);
    this.setQueryParams(url, { include_metrics: opts.includeMetrics });
    return this.getJson<StepTemplate>(url.toString(), 'Step template');
  }
}
