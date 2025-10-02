import { LLMRequestLogFeedback, LLMRequestLogFeedbackPayload, LLMRequestLogFeedbackResponse } from '../types';

export interface FeedbackServiceConfig {
  apiKey: string;
  silent: boolean;
}

export class FeedbackService {
  private apiKey: string;
  private silent: boolean;
  private apiEndpoint: string;

  constructor(config: FeedbackServiceConfig) {
    this.apiKey = config.apiKey;
    this.silent = config.silent;
    this.apiEndpoint = 'https://coolhand.io/api/v2/llm_request_log_feedbacks';
  }

  public async createFeedback(feedback: LLMRequestLogFeedback): Promise<LLMRequestLogFeedbackResponse | null> {
    const payload: LLMRequestLogFeedbackPayload = {
      llm_request_log_feedback: feedback
    };

    const requestOptions: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey
      },
      body: JSON.stringify(payload)
    };

    try {
      if (!this.silent) {
        console.log(`\n📝 CREATING FEEDBACK for LLM Request Log ID: ${feedback.llm_request_log_id}`);
        console.log(`👍/👎 Like: ${feedback.like}`);
        if (feedback.explanation) {
          console.log(`💭 Explanation: ${feedback.explanation.substring(0, 100)}${feedback.explanation.length > 100 ? '...' : ''}`);
        }
        console.log(`📤 Sending to: ${this.apiEndpoint}`);
      }

      // Use fetch if available
      if (typeof fetch !== 'undefined') {
        const response = await fetch(this.apiEndpoint, requestOptions);

        if (response.ok) {
          const result = await response.json() as LLMRequestLogFeedbackResponse;
          this.log(`✅ Successfully created feedback with ID: ${result.id}`);

          if (!this.silent) {
            console.log('═'.repeat(60));
          }

          return result;
        } else {
          const errorText = await response.text();
          console.error(`❌ Failed to create feedback: ${response.status} - ${errorText}`);
          return null;
        }
      } else {
        console.error('❌ Fetch not available. Feedback service requires Node.js 18+ or a fetch polyfill.');
        return null;
      }

    } catch (error) {
      console.error(`❌ Error creating feedback:`, (error as Error).message);
      return null;
    }
  }

  private log(...args: any[]): void {
    if (!this.silent) {
      console.log(...args);
    }
  }

  public getApiEndpoint(): string {
    return this.apiEndpoint;
  }

}