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

export interface CoolhandLogResponse {
  id?: number;
  source_api?: string | null;
  source_api_result?: string | null;
  llm_provider_unique_id?: string | null;
  warnings?: string[];
  [key: string]: unknown;
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
  /** Either the raw integer FK or a hashid string (e.g. from a prior response's llm_request_log_id) — the server accepts both on write. */
  llm_request_log_id?: number | string;
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

// JSON-RPC 2.0 response shape from the `/mcp` endpoint's `tools/call` method.
export interface McpToolCallResponse {
  result?: unknown;
  error?: { message?: string; [key: string]: unknown };
}

export interface LLMRequestLogFeedbackResponse {
  /** Hashid, not the raw integer FK. */
  id: string;
  /** Hashid, not the raw integer FK — null when this feedback isn't linked to a specific logged request. */
  llm_request_log_id: string | null;
  /** @deprecated Use `sentiment` instead */
  like?: boolean;
  sentiment?: "like" | "dislike" | "neutral";
  /** What kind of creator submitted the feedback: "human", "agent", or "unknown". */
  creator_type?: "human" | "agent" | "unknown";
  creator_unique_id?: string;
  /** Hashid of the workload this feedback is associated with, set server-side from workload_hashid on create.
   *  (There is no separate workload_hashid field on responses — workload_hashid is write-only, on LLMRequestLogFeedback.) */
  workload_id?: string | null;
  explanation?: string;
  revised_output?: string;
  llm_provider_unique_id?: string;
  original_output?: string;
  client_unique_id?: string;
  created_at: string;
  updated_at: string;
}