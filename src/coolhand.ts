import { CoolhandOptions, CoolhandCallData, CoolhandStats, LLMRequestLogFeedback, LLMRequestLogFeedbackResponse, CoolhandMatchedPattern } from './types.js';
import { PatternMatchingService } from './services/PatternMatchingService.js';
import { RequestMonitoringService } from './services/RequestMonitoringService.js';
import { LoggingService } from './services/LoggingService.js';
import { FeedbackService } from './services/FeedbackService.js';
import { DEFAULT_EXCLUDE_API_PATTERNS } from './default-exclude-api-patterns.js';

export class Coolhand {
  private patternMatchingService: PatternMatchingService;
  private requestMonitoringService: RequestMonitoringService;
  private loggingService: LoggingService;
  private feedbackService: FeedbackService;
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
    this.requestMonitoringService = new RequestMonitoringService(this.patternMatchingService, this.silent);
    this.requestMonitoringService.excludeApiPatterns = [...(options.excludeApiPatterns ?? DEFAULT_EXCLUDE_API_PATTERNS)];

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
      console.log(`📋 Loaded ${this.patternMatchingService.getPatternsCountSync()} API patterns`);
    }

    this.requestMonitoringService.setupMonitoring();

    if (!this.silent) {
      console.log('✅ Coolhand ready - will log to API');
    }
  }

  // Public API methods

  /**
   * Create feedback for an LLM request log
   * @param feedback The feedback data
   * @returns Promise resolving to the created feedback response or null if failed
   */
  public async createFeedback(feedback: LLMRequestLogFeedback): Promise<LLMRequestLogFeedbackResponse | null> {
    return this.feedbackService.createFeedback(feedback, 'manual');
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