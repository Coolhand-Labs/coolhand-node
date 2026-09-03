import {
  CoolhandCallData,
  CoolhandLogPayload,
  CoolhandLogResponse,
  CoolhandMatchedPattern,
  GetLogContentOptions,
  GetLogContentSliceOptions,
  GetLogContentSearchOptions,
  LlmRequestLogContent,
  LlmRequestLogContentFull,
  LlmRequestLogContentSearchResult,
  LlmRequestLogSummary,
  SearchLogsParams,
  SearchLogsResponse
} from '../types';
import { CollectionMethod } from '../utils/collector.js';
import { formatErrorMessage } from '../utils/format-error.js';
import { BaseService, BaseServiceConfig } from './BaseService.js';

export interface LoggingServiceConfig extends BaseServiceConfig {}

export class LoggingService extends BaseService {
  constructor(config: LoggingServiceConfig) {
    super(config, '/api/v2/llm_request_logs');
  }

  public async logRequestToAPI(
    callData: CoolhandCallData,
    matchedPattern?: CoolhandMatchedPattern,
    collectionMethod?: CollectionMethod,
    collector?: string,
    metadata?: Record<string, unknown>
  ): Promise<CoolhandLogResponse | null> {
    try {
      // An explicit collector string (e.g. from coolhand-cli) overrides the SDK-derived one.
      const logData = collector !== undefined
        ? { raw_request: callData, collector, ...(metadata && { metadata }) }
        : { ...this.addCollectorToData({ raw_request: callData }, collectionMethod), ...(metadata && { metadata }) };

      const payload: CoolhandLogPayload = {
        llm_request_log: logData
      };

      this.logRequestInfo(callData, matchedPattern);

      const result = await this.sendRequest<CoolhandLogResponse>(
        payload,
        `✅ Successfully logged to API with ID for call #${callData.id}`
      );

      this.logSeparator();

      return result;
    } catch (error) {
      if (!this.silent) {
        console.error(`❌ Failed to log request to API:`, formatErrorMessage(error));
      }
      return null;
    }
  }

  /**
   * Fetch full input/output content for a single log by ID. Requires the client's **private**
   * API key — the public key used by {@link logRequestToAPI} will 401 here.
   *
   * @param logId The log's hashid.
   * @param opts `section`/`maxChars` for large logs, or `searchQuery` for snippet search
   *   (mutually exclusive with `section`/`maxChars` — enforced by the overloads below), plus
   *   `includeThinking`.
   * @throws Error if `logId` is blank/whitespace-only or a bare dot-segment (`.`/`..`) — either
   *   would otherwise silently resolve away to the `index` route or beyond (returning a bare array
   *   typed as a single log's content) rather than 404ing on `show`. Also throws if `searchQuery`
   *   is blank/whitespace-only, which would silently fall through to the content shape server-side
   *   while the overload above promises a search result. Error on network failure or a non-JSON
   *   body. A non-2xx response throws an error whose `status` property holds the HTTP status code
   *   (e.g. 404 for an unknown ID).
   */
  public async getLogContent(logId: string, opts?: GetLogContentSliceOptions): Promise<LlmRequestLogContentFull>;
  public async getLogContent(logId: string, opts: GetLogContentSearchOptions): Promise<LlmRequestLogContentSearchResult>;
  public async getLogContent(logId: string, opts: GetLogContentOptions): Promise<LlmRequestLogContent>;
  public async getLogContent(logId: string, opts: GetLogContentOptions = {}): Promise<LlmRequestLogContent> {
    const url = this.buildResourceUrl(logId, 'getLogContent: logId must be a non-empty string');
    if (opts.section !== undefined) {
      url.searchParams.set('section', opts.section);
    }
    if (opts.maxChars !== undefined) {
      url.searchParams.set('max_chars', String(opts.maxChars));
    }
    if (opts.searchQuery !== undefined) {
      // The backend branches on Rails' `.present?` (blank/whitespace-only counts as absent), not
      // mere non-undefined-ness — sending a blank query would silently fall through to the content
      // shape server-side while the search-options overload above promises callers a search result.
      // typeof-checked (not just trim()) so a non-TS caller passing the wrong type gets this
      // message instead of a raw "searchQuery.trim is not a function" TypeError.
      if (typeof opts.searchQuery !== 'string' || opts.searchQuery.trim() === '') {
        throw new Error('getLogContent: searchQuery must be a non-empty string');
      }
      url.searchParams.set('search_query', opts.searchQuery);
    }
    if (opts.includeThinking !== undefined) {
      url.searchParams.set('include_thinking', String(opts.includeThinking));
    }
    return this.getJson<LlmRequestLogContent>(url.toString(), 'Log');
  }

  /**
   * Search logs by named filters (`templateId`, `workloadId`, `model`, etc.) — not raw Ransack
   * predicates, unlike `FeedbackService#searchFeedback` — applied on top of the endpoint's
   * existing Ransack-backed search/sort; `sort` reaches that directly, sent as `q[s]`. Requires
   * the client's **private** API key, same as {@link getLogContent}.
   *
   * @returns `{ logs, pagination }` — the matching logs for the requested page, plus pagination
   *   totals. The backing endpoint renders `logs` as a bare array on the wire and, once
   *   Coolhand-Labs/coolhand#1096 ships, exposes pagination via X-Total-Count/X-Page/X-Per-Page/
   *   X-Total-Pages response headers instead of a body envelope; this method reads those headers
   *   when present, assembling the same `Pagination` shape `searchFeedback` embeds in its body.
   *   Until #1096 deploys, those headers are absent and `pagination` is derived from `logs`/
   *   `params` instead (see `BaseService#paginationFromHeaders`) rather than falsely reporting zero
   *   results. Pass `params.includeTotal` to opt into exact totals at the cost of a `COUNT(*)` on
   *   the backend — left unset, the estimate above is used.
   * @throws Error on network failure or a non-JSON body. A non-2xx response throws an error
   *   whose `status` property holds the HTTP status code.
   */
  public async searchLogs(params: SearchLogsParams = {}): Promise<SearchLogsResponse> {
    const url = new URL(this.apiEndpoint);

    const queryParams = {
      template_id: params.templateId,
      workload_id: params.workloadId,
      system_prompt_contains: params.systemPromptContains,
      user_prompt_contains: params.userPromptContains,
      model: params.model,
      source_api: params.sourceApi,
      source_api_result: params.sourceApiResult,
      unmatched_only: params.unmatchedOnly,
      days_back: params.daysBack,
      include_prompts: params.includePrompts,
      'q[s]': params.sort,
      page: params.page,
      per: params.per,
      include_total: params.includeTotal
    };
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    const { body, headers } = await this.getJsonWithHeaders<LlmRequestLogSummary[]>(url.toString(), 'Log');
    return { logs: body, pagination: this.paginationFromHeaders(headers, body, params) };
  }

  private logRequestInfo(callData: CoolhandCallData, matchedPattern?: CoolhandMatchedPattern): void {
    if (!this.silent) {
      const apiName = matchedPattern?.pattern.name || 'API';
      console.log(`\n🎉 LOGGING ${apiName} API Call #${callData.id}`);
      console.log(`🕐 Time: ${callData.timestamp}`);
      console.log(`🎯 ${callData.method} ${callData.url}`);
      console.log(`📊 Status: ${callData.status_code}`);
      console.log(`🔧 Protocol: ${callData.protocol}`);
      if (matchedPattern) {
        console.log(`🔍 Matched by: ${matchedPattern.matchType} (${matchedPattern.matchValue})`);
      }

      if (callData.request_body?.model) {
        console.log(`🤖 Model: ${callData.request_body.model}`);
      }

      if (callData.request_body?.messages) {
        console.log(`💬 Messages: ${callData.request_body.messages.length}`);
      }

      if (callData.request_body?.temperature !== undefined) {
        console.log(`🌡️  Temperature: ${callData.request_body.temperature}`);
      }

      if (this.dryRun) {
        console.log(`🚫 DRY RUN: API call will be skipped`);
      } else {
        console.log(`📤 Sending to: ${this.apiEndpoint}`);
      }
    }
  }

}