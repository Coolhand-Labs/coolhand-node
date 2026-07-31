import {
  LLMRequestLogFeedback,
  LLMRequestLogFeedbackPayload,
  LLMRequestLogFeedbackResponse,
  SearchFeedbackParams,
  SearchFeedbackResponse,
  LLMRequestLogFeedbackDetail
} from '../types';
import { CollectionMethod } from '../utils/collector.js';
import { BaseService, BaseServiceConfig } from './BaseService.js';

export interface FeedbackServiceConfig extends BaseServiceConfig {}

export class FeedbackService extends BaseService {
  constructor(config: FeedbackServiceConfig) {
    super(config, '/api/v2/llm_request_log_feedbacks');
  }

  private normalizeSentiment(feedback: LLMRequestLogFeedback): LLMRequestLogFeedback {
    if (feedback.sentiment !== undefined || feedback.like === undefined) { return feedback; }
    const { like, ...rest } = feedback;
    return { ...rest, sentiment: like ? 'like' : 'dislike' };
  }

  public async createFeedback(feedback: LLMRequestLogFeedback, collectionMethod?: CollectionMethod): Promise<LLMRequestLogFeedbackResponse | null> {
    const normalized = this.normalizeSentiment(feedback);
    const feedbackWithCollector = this.addCollectorToData(normalized, collectionMethod);

    const payload: LLMRequestLogFeedbackPayload = {
      llm_request_log_feedback: feedbackWithCollector
    };

    this.logFeedbackInfo(normalized);

    const result = await this.sendRequest<LLMRequestLogFeedbackResponse>(
      payload,
      `✅ Successfully created feedback with ID: ${feedback.llm_request_log_id || 'N/A'}`
    );

    this.logSeparator();
    return result;
  }

  /**
   * Search feedback records. Requires the client's **private** API key — the public key used
   * by `createFeedback` will 401 here.
   *
   * @param params Raw Ransack predicates (e.g. `sentiment_eq`, `explanation_cont`) plus `s`
   *   (sort) and `page`/`per` (pagination). Wrapped as `q[<key>]` query params on the wire.
   * @returns The `:summary` view of matching feedback records plus pagination metadata.
   * @throws Error on network failure or a non-JSON body. A non-2xx response throws an error
   *   whose `status` property holds the HTTP status code.
   */
  public async searchFeedback(params: SearchFeedbackParams = {}): Promise<SearchFeedbackResponse> {
    const { page, per, ...predicates } = params;
    const url = new URL(this.apiEndpoint);
    for (const [key, value] of Object.entries(predicates)) {
      if (value !== undefined) {
        url.searchParams.set(`q[${key}]`, String(value));
      }
    }
    if (page !== undefined) {
      url.searchParams.set('page', String(page));
    }
    if (per !== undefined) {
      url.searchParams.set('per', String(per));
    }
    return this.getJson<SearchFeedbackResponse>(url.toString(), 'Feedback');
  }

  /**
   * Get a single feedback record by ID. Requires the client's **private** API key, same as
   * {@link searchFeedback}.
   *
   * @param id The feedback record ID.
   * @returns The `:with_partials` view: the full record, including `original_output`/
   *   `revised_output`/`feedback_partials`.
   * @throws Error on network failure or a non-JSON body. A non-2xx response throws an error
   *   whose `status` property holds the HTTP status code (e.g. 404 for an unknown ID).
   */
  public async getFeedback(id: string): Promise<LLMRequestLogFeedbackDetail> {
    return this.getJson<LLMRequestLogFeedbackDetail>(`${this.apiEndpoint}/${encodeURIComponent(id)}`, 'Feedback');
  }

  private logFeedbackInfo(feedback: LLMRequestLogFeedback): void {
    if (!this.silent) {
      console.log(`\n📝 CREATING FEEDBACK for LLM Request Log ID: ${feedback.llm_request_log_id}`);
      console.log(`🎭 Sentiment: ${feedback.sentiment ?? 'N/A'}`);
      if (feedback.explanation) {
        console.log(`💭 Explanation: ${feedback.explanation.substring(0, 100)}${feedback.explanation.length > 100 ? '...' : ''}`);
      }
      if (this.dryRun) {
        console.log(`🚫 DRY RUN: API call will be skipped`);
      } else {
        console.log(`📤 Sending to: ${this.apiEndpoint}`);
      }
    }
  }
}