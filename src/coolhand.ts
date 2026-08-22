import { CoolhandOptions, CoolhandCallData, CoolhandLogResponse, CoolhandStats, LLMRequestLogFeedback, LLMRequestLogFeedbackResponse, CoolhandMatchedPattern, SearchFeedbackParams, SearchFeedbackResponse, LLMRequestLogFeedbackDetail, GetLogContentOptions, GetLogContentSliceOptions, GetLogContentSearchOptions, LlmRequestLogContent, LlmRequestLogContentFull, LlmRequestLogContentSearchResult, SearchLogsParams, SearchLogsResponse, CoolhandClientFilePayload, CoolhandClientFileResponse } from './types.js';
import { PatternMatchingService } from './services/PatternMatchingService.js';
import { RequestMonitoringService } from './services/RequestMonitoringService.js';
import { LoggingService } from './services/LoggingService.js';
import { FeedbackService } from './services/FeedbackService.js';
import { ClientFileService } from './services/ClientFileService.js';
import { DEFAULT_EXCLUDE_API_PATTERNS } from './default-exclude-api-patterns.js';

export class Coolhand {
  private patternMatchingService: PatternMatchingService;
  private requestMonitoringService: RequestMonitoringService;
  private loggingService: LoggingService;
  private feedbackService: FeedbackService;
  private clientFileService: ClientFileService;
  private silent: boolean;

  constructor(options: CoolhandOptions) {
    // Configuration options
    this.silent = options.silent !== false;
    const apiKey = options.apiKey;

    if (!apiKey) {
      console.error('❌ API key is required for logging. Pass it in options.apiKey');
      throw new Error('API key is required');
    }

    // TODO: remove after v1.x.x — backward-compat shim for deprecated `environment` option
    if (options.environment !== undefined) {
      console.warn(
        '[coolhand-node] DEPRECATION WARNING: The `environment` option was removed in v0.4.0. ' +
        "Use `baseUrl: 'http://localhost:3000'` instead of `environment: 'local'`. " +
        'Remove `environment: \'production\'` — the default endpoint is unchanged.'
      );
      if (options.environment === 'local' && options.baseUrl === undefined) {
        options = { ...options, baseUrl: 'http://localhost:3000' };
      }
    }

    // Initialize services
    this.patternMatchingService = new PatternMatchingService({ customPatternsFile: options.patternsFile, silent: this.silent });

    const serviceConfig = {
      apiKey,
      silent: this.silent,
      debug: options.debug,
      dryRun: options.dryRun,
      baseUrl: options.baseUrl
    };

    this.loggingService = new LoggingService(serviceConfig);
    this.feedbackService = new FeedbackService(serviceConfig);
    this.clientFileService = new ClientFileService(serviceConfig);
    this.requestMonitoringService = new RequestMonitoringService(this.patternMatchingService, this.silent);
    this.requestMonitoringService.excludeApiPatterns = [...(options.excludeApiPatterns ?? DEFAULT_EXCLUDE_API_PATTERNS)];
    this.requestMonitoringService.setSelfApiEndpoint(this.loggingService.getApiEndpoint());

    // Set up the callback for when requests are completed
    this.requestMonitoringService.onRequestComplete = (callData: CoolhandCallData, matchedPattern?: CoolhandMatchedPattern) => {
      this.loggingService.logRequestToAPI(callData, matchedPattern, 'manual');
    };

    if (options.debug && !options.dryRun) {
      console.warn(
        '[coolhand-node] DEPRECATION WARNING: `debug: true` no longer suppresses API calls. ' +
        'Use `dryRun: true` to prevent data submission. ' +
        '`debug` now only enables verbose logging.'
      );
    }

    if (!this.silent) {
      console.log('🔍 Setting up Coolhand...');
      if (options.dryRun) {
        console.log('🚫 DRY RUN MODE: API calls will be skipped — no data will be submitted');
      }
      if (options.debug) {
        console.log('🔬 DEBUG MODE: Verbose logging enabled');
      }
      console.log(`🎯 API Endpoint: ${this.loggingService.getApiEndpoint()}`);
    }

    this.requestMonitoringService.setupMonitoring();

    if (!this.silent) {
      console.log('✅ Coolhand ready - will log to API');
    }
  }

  // Public API methods

  /**
   * Manually submit a single captured LLM request/response to Coolhand.
   *
   * Use this for logs that did not flow through automatic monitoring — for example the
   * coolhand-cli `capture-sessions` tool submitting locally-saved Claude Code / Codex
   * session turns.
   *
   * @param rawRequest The captured request/response payload.
   * @param options Optional settings. `collector` identifies the submission source and
   *   overrides the default SDK collector string. `metadata` is a free-form object; the one
   *   convention the backend uses is `project_path` (e.g. `{ project_path: '/Users/me/my-project' }`
   *   — see the Understanding an LLM Request Log guide's Metadata section).
   * @returns Promise resolving to the created log response, or null if submission failed
   *   or if the request was sent via the HTTPS fallback (Node.js < 18, where the response
   *   body is not parsed).
   */
  public async logRequest(
    rawRequest: CoolhandCallData,
    options?: { collector?: string; metadata?: Record<string, unknown> }
  ): Promise<CoolhandLogResponse | null> {
    return this.loggingService.logRequestToAPI(rawRequest, undefined, 'manual', options?.collector, options?.metadata);
  }

  /**
   * Create feedback for an LLM request log
   * @param feedback The feedback data
   * @returns Promise resolving to the created feedback response or null if failed
   */
  public async createFeedback(feedback: LLMRequestLogFeedback): Promise<LLMRequestLogFeedbackResponse | null> {
    return this.feedbackService.createFeedback(feedback, 'manual');
  }

  /**
   * Upload a file (slide deck, report, or document) to Coolhand.
   *
   * Requires the **private** API key — construct this `Coolhand` instance with `apiKey` set to
   * your private key, not the public key used for `createFeedback`/`logRequest`, which 401s here.
   *
   * Uploads always land with `status: draft` — `status` is not settable via this method.
   * Requires Node.js 18+ (uses global `fetch`/`FormData`; there is no fallback for pre-18 Node).
   *
   * @param payload The file to upload plus optional `file_type`, `description`, and `metadata`.
   * @returns Promise resolving to the created client file response, or null if the upload failed.
   */
  public async uploadClientFile(payload: CoolhandClientFilePayload): Promise<CoolhandClientFileResponse | null> {
    return this.clientFileService.createClientFile(payload);
  }

  /**
   * Search feedback records using raw Ransack predicates (`q[...]` keys) plus `page`/`per`.
   *
   * Requires the **private** API key — construct this `Coolhand` instance with `apiKey` set to
   * your private key, not the public key used for `createFeedback`/`logRequest`, which 401s here.
   *
   * @param params Ransack predicates (e.g. `sentiment_eq`, `explanation_cont`), `s` (sort), and
   *   `page`/`per` (pagination).
   * @returns The matching feedback records (`:summary` view) plus pagination metadata.
   * @throws Error on network failure or a non-JSON body. A non-2xx response throws an error
   *   whose `status` property holds the HTTP status code.
   */
  public async searchFeedback(params?: SearchFeedbackParams): Promise<SearchFeedbackResponse> {
    return this.feedbackService.searchFeedback(params);
  }

  /**
   * Get a single feedback record by ID, including `original_output`/`revised_output`/
   * `feedback_partials`.
   *
   * Requires the **private** API key, same as {@link searchFeedback}.
   *
   * @param id The feedback record ID.
   * @returns The full feedback record (`:with_partials` view).
   * @throws Error if `id` is blank/whitespace-only or a bare dot-segment (`.`/`..`). Error on
   *   network failure or a non-JSON body. A non-2xx response throws an error whose `status`
   *   property holds the HTTP status code (e.g. 404 for an unknown ID).
   */
  public async getFeedback(id: string): Promise<LLMRequestLogFeedbackDetail> {
    return this.feedbackService.getFeedback(id);
  }

  /**
   * Fetch full input/output content for a single log by ID.
   *
   * Requires the **private** API key — construct this `Coolhand` instance with `apiKey` set to
   * your private key, not the public key used for `createFeedback`/`logRequest`, which 401s here.
   *
   * @param logId The log's hashid.
   * @param opts `section`/`maxChars` for large logs, or `searchQuery` for snippet search
   *   (mutually exclusive with `section`/`maxChars` — enforced by the overloads below), plus
   *   `includeThinking`.
   * @throws Error if `logId` is blank/whitespace-only or a bare dot-segment (`.`/`..`), or if
   *   `searchQuery` is blank/whitespace-only. Error on network failure or a non-JSON body. A
   *   non-2xx response throws an error whose `status` property holds the HTTP status code (e.g.
   *   404 for an unknown ID).
   */
  public async getLogContent(logId: string, opts?: GetLogContentSliceOptions): Promise<LlmRequestLogContentFull>;
  public async getLogContent(logId: string, opts: GetLogContentSearchOptions): Promise<LlmRequestLogContentSearchResult>;
  public async getLogContent(logId: string, opts: GetLogContentOptions): Promise<LlmRequestLogContent>;
  public async getLogContent(logId: string, opts?: GetLogContentOptions): Promise<LlmRequestLogContent> {
    return this.loggingService.getLogContent(logId, opts ?? {});
  }

  /**
   * Search logs by named filters (`templateId`, `workloadId`, `model`, etc.) — not raw Ransack
   * predicates, unlike {@link searchFeedback}.
   *
   * Requires the **private** API key, same as {@link getLogContent}.
   *
   * @returns `{ logs, pagination }` — the matching logs for the requested page, plus pagination
   *   totals. See `LoggingService#searchLogs`/`docs/log-search.md` for how `pagination` is sourced.
   * @throws Error on network failure or a non-JSON body. A non-2xx response throws an error
   *   whose `status` property holds the HTTP status code.
   */
  public async searchLogs(params?: SearchLogsParams): Promise<SearchLogsResponse> {
    return this.loggingService.searchLogs(params);
  }

  /**
   * Get sanitized headers for debugging purposes
   * @param headers Headers to sanitize
   * @param pattern Optional API pattern for pattern-specific sanitization
   * @returns Sanitized headers
   */
  public sanitizeHeaders(headers: any, pattern?: any): Record<string, any> {
    return this.patternMatchingService.sanitizeHeaders(headers, pattern);
  }

  /**
   * Get monitoring statistics
   * @returns Statistics about requests and interceptions
   */
  public getStats(): CoolhandStats {
    const monitoringStats = this.requestMonitoringService.getStats();
    return {
      totalRequests: monitoringStats.totalRequests,
      interceptedCalls: monitoringStats.interceptedCalls,
      apiEndpoint: this.loggingService.getApiEndpoint()
    };
  }

  public get excludeApiPatterns(): string[] {
    return this.requestMonitoringService.excludeApiPatterns;
  }

  public set excludeApiPatterns(patterns: string[]) {
    this.requestMonitoringService.excludeApiPatterns = [...patterns];
  }
}