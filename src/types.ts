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
  /**
   * Hashid of the client that owns this feedback entry, matching every other external-facing
   * identifier on this record. Was a raw integer FK on live responses as of this writing;
   * tracking pattaya PR Coolhand-Labs/coolhand#1081, which fixes it to hashid-encode consistently.
   */
  client_id?: string;
  collector?: string;
  coolhand_fingerprint_id?: string;
  /** Validation issues encountered while creating this feedback record. */
  warnings?: { message: string; timestamp: string }[];
  /** Hashid of the `FeedbackPartial` generated when this feedback was created with sectional highlighting. */
  created_partial_id?: string;
  created_at: string;
  updated_at: string;
}

// Params for GET /api/v2/llm_request_log_feedbacks (search). Close to the wire format: raw
// Ransack predicate keys (e.g. `sentiment_eq`, `explanation_cont`) are wrapped as `q[<key>]`,
// `s` is the Ransack sort expression, and `page`/`per` are top-level pagination params. Exact
// supported predicates are whatever Api::V2::LlmRequestLogFeedbacksController#index accepts.
export interface SearchFeedbackParams {
  /** Ransack sort expression, e.g. "created_at desc". */
  s?: string;
  /**
   * Sentiment is stored server-side as an integer code — 0=dislike, 1=neutral, 2=like — which
   * responses render back as the `sentiment` string enum. Ransack's `sentiment_eq` predicate
   * takes the raw integer code, not the string label.
   */
  sentiment_eq?: 0 | 1 | 2;
  explanation_cont?: string;
  page?: number;
  per?: number;
  /** Any other Ransack predicate the search endpoint accepts (wrapped as q[<key>]=<value>). */
  [ransackPredicate: string]: string | number | boolean | undefined;
}

// :summary blueprint view for a search result item — omits `original_output`/`revised_output`,
// which can each hold up to 1GB.
export interface LLMRequestLogFeedbackSummary {
  /** Hashid identifier for the feedback record (not a raw integer). */
  id: string;
  /** Hashid, not the raw integer FK — null when this feedback isn't linked to a specific logged request. */
  llm_request_log_id: string | null;
  /** @deprecated Use `sentiment` instead */
  like?: boolean;
  sentiment?: "like" | "dislike" | "neutral";
  creator_type?: "human" | "agent" | "unknown";
  creator_unique_id?: string;
  /** Hashid of the associated workload (see {@link LLMRequestLogFeedbackResponse.workload_id}). */
  workload_id?: string | null;
  explanation?: string;
  llm_provider_unique_id?: string;
  client_unique_id?: string;
  /**
   * Hashid of the client that owns this feedback entry, matching every other external-facing
   * identifier on this record. Was a raw integer FK on live responses as of this writing;
   * tracking pattaya PR Coolhand-Labs/coolhand#1081, which fixes it to hashid-encode consistently.
   */
  client_id?: string;
  collector?: string;
  coolhand_fingerprint_id?: string;
  created_at: string;
  updated_at: string;
}

export interface FeedbackPagination {
  current_page: number;
  per_page: number;
  total_count: number;
  total_pages: number;
  has_next_page: boolean;
  has_prev_page: boolean;
}

export interface SearchFeedbackResponse {
  feedback: LLMRequestLogFeedbackSummary[];
  pagination: FeedbackPagination;
}

export interface LLMRequestLogFeedbackFocusRange {
  start: number;
  end: number;
}

// A single underlying feedback partial that was rolled up into a feedback record's aggregate
// sentiment/explanation (e.g. one highlighted span of a longer response).
export interface LLMRequestLogFeedbackPartial {
  id: string;
  llm_request_log_feedback_id: string;
  /**
   * Hashid of the client that owns the parent feedback record. Was a raw integer FK on live
   * responses as of this writing; tracking pattaya PR Coolhand-Labs/coolhand#1081, which fixes
   * it to hashid-encode consistently (matches {@link LLMRequestLogFeedbackResponse.client_id}).
   */
  client_id: string;
  focus_section?: string | null;
  focus_range?: LLMRequestLogFeedbackFocusRange | null;
  sentiment?: "like" | "dislike" | "neutral" | null;
  /** @deprecated Use `sentiment` instead */
  like?: boolean | null;
  explanation?: string | null;
  creator_unique_id?: string | null;
  coolhand_fingerprint_id?: string | null;
  created_at: string;
  updated_at: string;
}

// :with_partials blueprint view returned by GET /api/v2/llm_request_log_feedbacks/{id} — the full
// record, including original_output/revised_output plus the underlying feedback_partials.
export interface LLMRequestLogFeedbackDetail extends LLMRequestLogFeedbackResponse {
  feedback_partials?: LLMRequestLogFeedbackPartial[];
}