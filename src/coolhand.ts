import { CoolhandOptions, CallData, Stats, LLMRequestLogFeedback, LLMRequestLogFeedbackResponse, MatchedPattern } from './types';
import { PatternMatchingService } from './services/PatternMatchingService';
import { RequestMonitoringService } from './services/RequestMonitoringService';
import { LoggingService } from './services/LoggingService';
import { FeedbackService } from './services/FeedbackService';

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

    // Initialize services
    this.patternMatchingService = new PatternMatchingService(options.patternsFile);

    const serviceConfig = {
      apiKey,
      silent: this.silent
    };

    this.loggingService = new LoggingService(serviceConfig);
    this.feedbackService = new FeedbackService(serviceConfig);
    this.requestMonitoringService = new RequestMonitoringService(this.patternMatchingService, this.silent);

    // Set up the callback for when requests are completed
    this.requestMonitoringService.onRequestComplete = (callData: CallData, matchedPattern?: MatchedPattern) => {
      this.loggingService.logRequestToAPI(callData, matchedPattern);
    };

    if (!this.silent) {
      console.log('🔍 Setting up Coolhand...');
      console.log(`🎯 API Endpoint: ${this.loggingService.getApiEndpoint()}`);
      console.log(`📋 Loaded ${this.patternMatchingService.getPatternsCount()} API patterns`);
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
    return this.feedbackService.createFeedback(feedback);
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
   * Parse JSON string safely
   * @param str String to parse
   * @returns Parsed object or the original string if parsing fails
   */
  public parseJSON(str: string | null): any {
    if (!str) {return null;}
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  }

  /**
   * Get monitoring statistics
   * @returns Statistics about requests and interceptions
   */
  public getStats(): Stats {
    const monitoringStats = this.requestMonitoringService.getStats();
    return {
      totalRequests: monitoringStats.totalRequests,
      interceptedCalls: monitoringStats.interceptedCalls,
      apiEndpoint: this.loggingService.getApiEndpoint()
    };
  }
}