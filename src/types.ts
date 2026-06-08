export interface CoolhandOptions {
  apiKey: string;
  silent?: boolean;
  patternsFile?: string;
  debug?: boolean;
  dryRun?: boolean;
  baseUrl?: string;
  excludeApiPatterns?: string[];
  /** @deprecated Use `baseUrl` instead. Removed in v0.4.0; shim will be removed after v1.x.x. */
  environment?: 'local' | 'production';
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
    collector?: string;
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

// Types for LLM Request Log Feedback endpoint
export interface LLMRequestLogFeedback {
  llm_request_log_id?: number;
  /** @deprecated Use `sentiment` instead */
  like?: boolean;
  sentiment?: "like" | "dislike" | "neutral";
  /** What kind of creator supplied the feedback. Defaults to "unknown" server-side when omitted. */
  creator_type?: "human" | "agent" | "unknown";
  creator_unique_id?: string;
  workload_hashid?: string;
  explanation?: string;
  revised_output?: string;
  llm_provider_unique_id?: string;
  original_output?: string;
  client_unique_id?: string;
  collector?: string;
}

export interface LLMRequestLogFeedbackPayload {
  llm_request_log_feedback: LLMRequestLogFeedback;
}

export interface LLMRequestLogFeedbackResponse {
  id: number;
  llm_request_log_id: number;
  /** @deprecated Use `sentiment` instead */
  like?: boolean;
  sentiment?: "like" | "dislike" | "neutral";
  /** What kind of creator submitted the feedback: "human", "agent", or "unknown". */
  creator_type?: "human" | "agent" | "unknown";
  creator_unique_id?: string;
  workload_hashid?: string;
  explanation?: string;
  revised_output?: string;
  llm_provider_unique_id?: string;
  original_output?: string;
  client_unique_id?: string;
  created_at: string;
  updated_at: string;
}