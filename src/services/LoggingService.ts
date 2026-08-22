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

// Treats a missing or non-integer header value (empty string, decimals, hex, negative, garbage
// text) as absent, falling back rather than propagating a nonsensical value into a response type
// callers assume is always a valid non-negative integer. Deliberately stricter than `Number(...)`
// — e.g. `Number('')` is `0`, which would otherwise silently look like a legitimate zero count.
function parseHeaderInt(value: string | null, fallback: number): number {
  if (value === null) {
    return fallback;
  }
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : fallback;
}

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
   *   `params` instead (see {@link paginationFromHeaders}) rather than falsely reporting zero
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

  // X-Total-Count/X-Page/X-Per-Page/X-Total-Pages are set by the backend's pagination_headers
  // concern (Coolhand-Labs/coolhand#1096, not yet merged as of this writing) — until that ships,
  // X-Total-Count is absent here.
  private paginationFromHeaders(headers: Headers, logs: LlmRequestLogSummary[], params: SearchLogsParams): Pagination {
    // Api::V2::LlmRequestLogsController::DEFAULT_PER_PAGE/MAX_PER_PAGE — mirrored here only for
    // the pre-#1096 fallback below; once X-Total-Count is present, the server's real values are
    // used directly instead.
    const DEFAULT_PER_PAGE = 25;
    const MAX_PER_PAGE = 100;

    // Math.trunc (not Math.floor) on `per` to match how the server coerces it — `per_page` does
    // `(params[:per] || params[:per_page]).to_i`, and Ruby's String#to_i truncates toward zero
    // (e.g. "-5.5" -> -5, not -6). `page` gets no equivalent server-side coercion — will_paginate
    // raises on a non-positive/non-integer page rather than clamping it — so `requestedPage` below
    // is truncated/clamped purely to keep this SDK's own pre-#1096 fallback `Pagination` object
    // sane, not to mirror server behavior. `params.page`/`params.per` are typed `number`, so a
    // caller-supplied `NaN` is type-legal; `Math.max(1, NaN)` is `NaN`, not `1`, so that's guarded
    // explicitly rather than relying on the clamp.
    const truncatedPage = Math.trunc(params.page ?? 1);
    const requestedPage = Number.isFinite(truncatedPage) ? Math.max(1, truncatedPage) : 1;
    const truncatedPer = Math.trunc(params.per ?? 0);
    const requestedPer = truncatedPer > 0 ? Math.min(truncatedPer, MAX_PER_PAGE) : DEFAULT_PER_PAGE;
    const hasTotalCount = headers.get('x-total-count') !== null;

    const currentPage = Math.max(1, parseHeaderInt(headers.get('x-page'), requestedPage));
    const perPage = parseHeaderInt(headers.get('x-per-page'), requestedPer);

    let totalCount: number;
    let totalPages: number;
    let hasNextPage: boolean;
    let hasPrevPage: boolean;

    if (hasTotalCount) {
      totalCount = parseHeaderInt(headers.get('x-total-count'), logs.length);
      // Fall back to a value derived from totalCount (not e.g. currentPage) if X-Total-Pages is
      // itself missing/malformed — a fallback unrelated to the real count could under-report the
      // page count and truncate a caller's pagination loop, exactly what totalCount's own
      // fallback (logs.length above) exists to avoid on the sibling header.
      totalPages = parseHeaderInt(
        headers.get('x-total-pages'),
        perPage > 0 ? Math.ceil(totalCount / perPage) : (totalCount > 0 ? 1 : 0)
      );
      hasNextPage = currentPage < totalPages;
      // Both searchLogs and searchFeedback's backends paginate via will_paginate (not Kaminari —
      // ActiveRecord::Relation#page is will_paginate's; Kaminari is only used elsewhere, on plain
      // arrays), whose `previous_page` has no out-of-range check: `current_page > 1 ? ... : nil`.
      // Match that exactly (no `&& currentPage <= totalPages` guard) for genuine parity with
      // searchFeedback's `previous_page.present?`, rather than inventing stricter semantics no
      // backend here actually implements.
      hasPrevPage = currentPage > 1;
    } else if (logs.length > 0) {
      // Rather than let a missing/malformed header silently report total_count: 0 alongside a
      // non-empty `logs`, total_count/total_pages fall back to a lower-bound estimate: every
      // prior page assumed full, plus this page's actual result count. This bound is sound
      // specifically *because* `logs` is non-empty — offset-based pagination (`OFFSET (page-1)*per
      // LIMIT per`) can only return rows if that many preceding rows exist, so a real result at
      // `currentPage` proves at least `(currentPage - 1) * perPage` prior rows exist regardless of
      // how large `currentPage` is. It's still only ever a lower bound though — NOT reliable
      // enough to derive has_next_page/has_prev_page from (a full page doesn't prove there's
      // nothing beyond it), so has_next_page is derived independently: a full page implies there
      // may be more.
      totalCount = perPage > 0 ? (currentPage - 1) * perPage + logs.length : logs.length;
      totalPages = perPage > 0 ? Math.ceil(totalCount / perPage) : currentPage;
      hasNextPage = perPage > 0 && logs.length >= perPage;
      hasPrevPage = currentPage > 1;
    } else {
      // An EMPTY page proves the opposite of a non-empty one: it means `currentPage` is at or past
      // the end (or the search matched nothing at all), not that `(currentPage - 1) * perPage`
      // prior rows exist — extrapolating from `currentPage` here would fabricate a total governed
      // entirely by whatever `page` the caller happened to pass (e.g. `page: 1000000` -> a
      // fictitious ~25M-row total). With no evidence of how many real rows exist, report what we
      // can actually confirm: none, on this page.
      totalCount = 0;
      totalPages = 0;
      hasNextPage = false;
      // Still page-relative, not result-relative: a caller can always step back toward page 1
      // regardless of whether this specific page happened to come back empty.
      hasPrevPage = currentPage > 1;
    }

    return {
      current_page: currentPage,
      per_page: perPage,
      total_count: totalCount,
      total_pages: totalPages,
      has_next_page: hasNextPage,
      has_prev_page: hasPrevPage
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