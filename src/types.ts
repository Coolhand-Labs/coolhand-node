export interface CoolhandOptions {
  apiKey: string;
  silent?: boolean;
  patternsFile?: string;
}

export interface CallData {
  id: number;
  timestamp: string;
  method: string;
  url: string;
  headers: Record<string, any>;
  request_body: any;
  response_body: any;
  response_headers: Record<string, any> | null;
  status_code: number | null;
  protocol: string;
}

export interface Stats {
  totalRequests: number;
  interceptedCalls: number;
  apiEndpoint: string;
}

export interface RequestOptions {
  hostname?: string;
  host?: string;
  port?: number;
  path?: string;
  method?: string;
  headers?: Record<string, any>;
  href?: string;
  url?: string;
}

export interface LogPayload {
  llm_request_log: {
    raw_request: CallData;
  };
}

export interface APIPattern {
  name: string;
  domains: string[];
  paths?: string[];
  headers?: Record<string, string>;
}

export interface APIPatterns {
  patterns: APIPattern[];
}

export interface MatchedPattern {
  pattern: APIPattern;
  matchType: 'domain' | 'path';
  matchValue: string;
}

// Types for LLM Request Log Feedback endpoint
export interface LLMRequestLogFeedback {
  llm_request_log_id: number;
  like: boolean;
  explanation?: string;
  revised_output?: string;
  llm_provider_unique_id?: string;
  original_output?: string;
  client_unique_id?: string;
}

export interface LLMRequestLogFeedbackPayload {
  llm_request_log_feedback: LLMRequestLogFeedback;
}

export interface LLMRequestLogFeedbackResponse {
  id: number;
  client_id: number;
  llm_request_log_id: number;
  like: boolean;
  explanation?: string;
  revised_output?: string;
  llm_provider_unique_id?: string;
  original_output?: string;
  client_unique_id?: string;
  created_at: string;
  updated_at: string;
}