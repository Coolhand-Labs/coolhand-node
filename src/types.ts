export interface CoolhandOptions {
  apiKey: string;
  silent?: boolean;
  patternsFile?: string;
}

export interface CoolhandCallData {
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

export interface CoolhandStats {
  totalRequests: number;
  interceptedCalls: number;
  apiEndpoint: string;
}

export interface CoolhandRequestOptions {
  hostname?: string;
  host?: string;
  port?: number;
  path?: string;
  method?: string;
  headers?: Record<string, any>;
  href?: string;
  url?: string;
}

export interface CoolhandLogPayload {
  llm_request_log: {
    raw_request: CoolhandCallData;
  };
}

export interface CoolhandAPIPattern {
  id?: string;
  name: string;
  domains: string[];
  paths?: string[];
  headers?: Record<string, string>;
}

export interface CoolhandAPIPatterns {
  patterns: CoolhandAPIPattern[];
}

export interface CoolhandMatchedPattern {
  pattern: CoolhandAPIPattern;
  matchType: 'domain' | 'path';
  matchValue: string;
}

// Legacy exports for backward compatibility (deprecated)
/** @deprecated Use CoolhandCallData instead */
export type CallData = CoolhandCallData;
/** @deprecated Use CoolhandStats instead */
export type Stats = CoolhandStats;
/** @deprecated Use CoolhandRequestOptions instead */
export type RequestOptions = CoolhandRequestOptions;
/** @deprecated Use CoolhandAPIPattern instead */
export type APIPattern = CoolhandAPIPattern;
/** @deprecated Use CoolhandAPIPatterns instead */
export type APIPatterns = CoolhandAPIPatterns;
/** @deprecated Use CoolhandMatchedPattern instead */
export type MatchedPattern = CoolhandMatchedPattern;

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