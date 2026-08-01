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
  Pagination,
  SearchLogsParams,
  SearchLogsResponse
} from '../types';
import { CollectionMethod } from '../utils/collector.js';
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
    collector?: string
  ): Promise<CoolhandLogResponse | null> {
    // An explicit collector string (e.g. from coolhand-cli) overrides the SDK-derived one.
    const logData = collector !== undefined
      ? { raw_request: callData, collector }
      : this.addCollectorToData({ raw_request: callData }, collectionMethod);

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
  }

  /**
   * Fetch full input/output content for a single log by ID. Requires the client's **private**
   * API key — the public key used by {@link logRequestToAPI} will 401 here.
   *
   * @param logId The log's hashid.
   * @param opts `section`/`maxChars` for large logs, or `searchQuery` for snippet search
   *   (mutually exclusive with `section`/`maxChars` — enforced by the overloads below), plus
   *   `includeThinking`.
   * @throws Error on network failure or a non-JSON body. A non-2xx response throws an error
   *   whose `status` property holds the HTTP status code (e.g. 404 for an unknown ID).
   */
  public async getLogContent(logId: string, opts?: GetLogContentSliceOptions): Promise<LlmRequestLogContentFull>;
  public async getLogContent(logId: string, opts: GetLogContentSearchOptions): Promise<LlmRequestLogContentSearchResult>;
  public async getLogContent(logId: string, opts: GetLogContentOptions): Promise<LlmRequestLogContent>;
  public async getLogContent(logId: string, opts: GetLogContentOptions = {}): Promise<LlmRequestLogContent> {
    const url = new URL(`${this.apiEndpoint}/${encodeURIComponent(logId)}`);
    if (opts.section !== undefined) {
      url.searchParams.set('section', opts.section);
    }
    if (opts.maxChars !== undefined) {
      url.searchParams.set('max_chars', String(opts.maxChars));
    }
    if (opts.searchQuery !== undefined) {
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
   *   totals. The backing endpoint renders `logs` as a bare array on the wire and exposes
   *   pagination via X-Total-Count/X-Page/X-Per-Page/X-Total-Pages response headers instead of a
   *   body envelope; this method reads those headers and assembles the same shape
   *   `searchFeedback` returns, so callers don't need to care about the wire-level difference.
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
      per: params.per
    };
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    const { body, headers } = await this.getJsonWithHeaders<LlmRequestLogSummary[]>(url.toString(), 'Log');
    return { logs: body, pagination: this.paginationFromHeaders(headers) };
  }

  // X-Total-Count/etc. are the standard pagination signal across every paginated coolhand
  // endpoint (see BaseService#getJsonWithHeaders) — has_next_page/has_prev_page aren't sent as
  // separate headers, so they're derived from current_page/total_pages here, same as the server
  // computes them for searchFeedback's body-embedded pagination object.
  private paginationFromHeaders(headers: Headers): Pagination {
    const currentPage = Number(headers.get('x-page') ?? '1');
    const perPage = Number(headers.get('x-per-page') ?? '0');
    const totalCount = Number(headers.get('x-total-count') ?? '0');
    const totalPages = Number(headers.get('x-total-pages') ?? '0');
    return {
      current_page: currentPage,
      per_page: perPage,
      total_count: totalCount,
      total_pages: totalPages,
      has_next_page: currentPage < totalPages,
      has_prev_page: currentPage > 1
    };
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