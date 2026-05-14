import { LLMRequestLogFeedback, LLMRequestLogFeedbackPayload, LLMRequestLogFeedbackResponse } from '../types';
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

  private logFeedbackInfo(feedback: LLMRequestLogFeedback): void {
    if (!this.silent) {
      console.log(`\n📝 CREATING FEEDBACK for LLM Request Log ID: ${feedback.llm_request_log_id}`);
      console.log(`🎭 Sentiment: ${feedback.sentiment ?? 'N/A'}`);
      if (feedback.explanation) {
        console.log(`💭 Explanation: ${feedback.explanation.substring(0, 100)}${feedback.explanation.length > 100 ? '...' : ''}`);
      }
      if (this.debug) {
        console.log(`🐛 DEBUG MODE: Will return mock response instead of API call`);
      } else {
        console.log(`📤 Sending to: ${this.apiEndpoint}`);
      }
    }
  }
}