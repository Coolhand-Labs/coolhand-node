import * as https from 'https';
import * as http from 'http';
import { Pagination } from '../types.js';
import { getCollectorString, CollectionMethod } from '../utils/collector.js';

// Treats a missing or non-integer header value (empty string, decimals, hex, negative, garbage
// text) as absent, falling back rather than propagating a nonsensical value into a response type
// callers assume is always a valid non-negative integer. Deliberately stricter than `Number(...)`
// — e.g. `Number('')` is `0`, which would otherwise silently look like a legitimate zero count.
function parseHeaderInt(value: string | null, fallback: number): number {
  if (value === null) {
    return fallback;
  }
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : fallback;
}

export interface BaseServiceConfig {
  apiKey: string;
  silent: boolean;
  debug?: boolean;
  dryRun?: boolean;
  baseUrl?: string;
}

function validateBaseUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid baseUrl: "${raw}" is not a valid URL`);
  }
  if (!url.hostname) {
    throw new Error(`baseUrl must include a hostname. Got: "${raw}"`);
  }
  if (url.protocol === 'https:') { return; }
  if (url.protocol === 'http:') {
    const h = url.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') { return; }
  }
  throw new Error(
    `baseUrl must use https:// (got: "${raw}"). For local dev, http://localhost is allowed.`
  );
}

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, '');
}

/**
 * Thrown by {@link BaseService.fetchWithHeaders} on a non-2xx response. Carries the HTTP `status`
 * so callers (e.g. the CLI) can react to it — a 401 vs. a 404 — without parsing the message string.
 */
export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export abstract class BaseService {
  protected apiKey: string;
  protected silent: boolean;
  protected debug: boolean;
  protected dryRun: boolean;
  protected apiEndpoint: string;

  constructor(config: BaseServiceConfig, endpointPath: string) {
    this.apiKey = config.apiKey;
    this.silent = config.silent;
    this.debug = config.debug || false;
    this.dryRun = config.dryRun || false;

    const rawBase = config.baseUrl ?? 'https://coolhandlabs.com';
    validateBaseUrl(rawBase);
    this.apiEndpoint = normalizeBaseUrl(rawBase) + endpointPath;
  }

  protected createRequestOptions(payload: any): RequestInit {
    return {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey
      },
      body: JSON.stringify(payload),
      redirect: 'error'
    };
  }

  protected addCollectorToData<T extends Record<string, any>>(
    data: T,
    collectionMethod?: CollectionMethod
  ): T & { collector: string } {
    return {
      ...data,
      collector: getCollectorString(collectionMethod)
    };
  }

  protected async sendRequest<T>(payload: any, successMessage: string): Promise<T | null> {
    if (this.dryRun) {
      if (!this.silent) {
        console.log(`🚫 DRY RUN: Skipping API call to ${this.apiEndpoint}`);
        console.log(`🚫 DRY RUN: Would send payload:`, JSON.stringify(payload, null, 2));
      }
      this.log(`🚫 DRY RUN: ${successMessage.replace('✅', '🚫')}`);
      return null;
    }

    if (this.debug && !this.silent) {
      console.log(`[coolhand-node] DEBUG: Sending to ${this.apiEndpoint}`);
      console.log(`[coolhand-node] DEBUG: Payload size: ${JSON.stringify(payload).length} bytes`);
    }

    const requestOptions = this.createRequestOptions(payload);

    try {
      if (typeof fetch !== 'undefined') {
        const response = await fetch(this.apiEndpoint, requestOptions);
        return await this.parseJsonResponse<T>(response, successMessage);
      } else {
        // Fallback to using https/http modules
        await this.sendWithHTTPS(payload);
        this.log(successMessage);
        return null; // HTTPS fallback doesn't return parsed response
      }
    } catch (error) {
      console.error(`❌ Request error:`, (error as Error).message);
      return null;
    }
  }

  /**
   * Shared success/failure handling for a `fetch` response, used by both {@link sendRequest} and
   * {@link sendMultipart}: JSON-parse and log on 2xx, log and resolve to `null` otherwise.
   */
  private async parseJsonResponse<T>(response: Response, successMessage: string): Promise<T | null> {
    if (response.ok) {
      const result = await response.json() as T;
      this.log(successMessage);
      return result;
    } else {
      const errorText = await response.text();
      console.error(`❌ Request failed: ${response.status} - ${errorText}`);
      return null;
    }
  }

  /**
   * POST a `FormData` body (multipart/form-data) — the upload counterpart to {@link sendRequest}.
   * Omits `Content-Type` so `fetch` sets the multipart boundary itself. There is no
   * `sendWithHTTPS`-style fallback for multipart, so this throws when global `fetch` is
   * unavailable rather than silently returning `null`, which would otherwise be indistinguishable
   * from a normal API failure. Non-2xx responses and network errors follow {@link sendRequest}'s
   * convention instead: logged and resolved to `null`.
   *
   * @throws Error if global `fetch` is unavailable (requires Node.js 18+).
   */
  protected async sendMultipart<T>(formData: FormData, successMessage: string): Promise<T | null> {
    if (this.dryRun) {
      if (!this.silent) {
        console.log(`🚫 DRY RUN: Skipping API call to ${this.apiEndpoint}`);
      }
      this.log(`🚫 DRY RUN: ${successMessage.replace('✅', '🚫')}`);
      return null;
    }

    if (this.debug && !this.silent) {
      console.log(`[coolhand-node] DEBUG: Sending multipart to ${this.apiEndpoint}`);
    }

    if (typeof fetch === 'undefined') {
      throw new Error(`Upload failed: global fetch is unavailable (requires Node.js 18+)`);
    }

    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: { 'X-API-Key': this.apiKey },
        body: formData,
        redirect: 'error'
      });

      return await this.parseJsonResponse<T>(response, successMessage);
    } catch (error) {
      console.error(`❌ Request error:`, (error as Error).message);
      return null;
    }
  }

  private async sendWithHTTPS(payload: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.apiEndpoint);
      const postData = JSON.stringify(payload);

      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'X-API-Key': this.apiKey
        }
      };

      const req = (url.protocol === 'https:' ? https : http).request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            console.error(`❌ Request failed: ${res.statusCode} - ${data}`);
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  /**
   * Fetch `url` and return the raw response body text plus headers, throwing on failure. The
   * shared fetch/error/status-throwing primitive both {@link fetchOrThrow} (discards the headers)
   * and {@link getJsonWithHeaders} (JSON-parses the body, keeps the headers — e.g. for
   * `LoggingService#searchLogs` reading pagination totals off X-Total-Count/etc.) sit on top of.
   * Always sent with `redirect: 'error'` (overriding anything in `init`) so a 3xx from `url`
   * throws instead of being followed — `url` is derived from the validated `apiEndpoint`, and
   * following a redirect would carry the `X-API-Key` header to a host `validateBaseUrl` never
   * approved.
   *
   * @param errorPrefix Prefixes thrown error messages, e.g. `"MCP request failed"` or
   *   `"Feedback request failed"`, so each caller keeps its own established message wording.
   * @throws Error if global `fetch` is unavailable (Node.js < 18) or on a network failure.
   *   {@link HttpError} (with `.status`) on a non-2xx response.
   */
  protected async fetchWithHeaders(
    url: string,
    init: RequestInit,
    errorPrefix: string
  ): Promise<{ text: string; headers: Headers }> {
    if (typeof fetch === 'undefined') {
      throw new Error(`${errorPrefix}: global fetch is unavailable (requires Node.js 18+)`);
    }

    let res: Response;
    try {
      res = await fetch(url, { ...init, redirect: 'error' });
    } catch (err) {
      throw new Error(`${errorPrefix}: ${(err as Error).message}`, { cause: err });
    }

    const text = await res.text().catch(() => '');
    if (!res.ok) {
      throw new HttpError(`${errorPrefix} (${res.status}): ${text.slice(0, 2000)}`, res.status);
    }
    return { text, headers: res.headers };
  }

  /**
   * Fetch `url` and return the raw response body text, throwing on failure. A thin wrapper around
   * {@link fetchWithHeaders} for callers that don't need response headers — currently just
   * `McpService.mcpCall` (as opposed to {@link sendRequest}'s POST/null-on-error convention).
   *
   * @param errorPrefix Prefixes thrown error messages, e.g. `"MCP request failed"`, so each
   *   caller keeps its own established message wording.
   * @throws Error if global `fetch` is unavailable (Node.js < 18) or on a network failure.
   *   {@link HttpError} (with `.status`) on a non-2xx response.
   */
  protected async fetchOrThrow(url: string, init: RequestInit, errorPrefix: string): Promise<string> {
    const { text } = await this.fetchWithHeaders(url, init, errorPrefix);
    return text;
  }

  /**
   * GET `url` and JSON-parse the response body, throwing on failure — the shared read-path used
   * by `FeedbackService`/`LoggingService`'s search/get methods (as opposed to {@link sendRequest}'s
   * POST/null-on-error convention).
   *
   * @param noun Capitalized noun identifying the caller, e.g. `"Feedback"` or `"Log"` — produces
   *   `"<noun> request failed (<status>): ..."` and `"<noun> response was not valid JSON: ..."`
   *   so each caller keeps its own established message wording.
   * @throws Error on network failure or a non-JSON body. {@link HttpError} (with `.status`) on a
   *   non-2xx response.
   */
  protected async getJson<T>(url: string, noun: string): Promise<T> {
    const { body } = await this.getJsonWithHeaders<T>(url, noun);
    return body;
  }

  /**
   * Like {@link getJson}, but also returns the response headers — for endpoints (e.g.
   * searchLogs) that expose metadata like pagination totals via X-Total-Count/etc. headers
   * rather than the response body.
   *
   * @throws Error on network failure or a non-JSON body. {@link HttpError} (with `.status`) on a
   *   non-2xx response.
   */
  protected async getJsonWithHeaders<T>(url: string, noun: string): Promise<{ body: T; headers: Headers }> {
    const { text, headers } = await this.fetchWithHeaders(
      url,
      { method: 'GET', headers: { Accept: 'application/json', 'X-API-Key': this.apiKey } },
      `${noun} request failed`
    );

    try {
      return { body: JSON.parse(text) as T, headers };
    } catch {
      throw new Error(`${noun} response was not valid JSON: ${text.slice(0, 2000)}`);
    }
  }

  /**
   * Build `${this.apiEndpoint}/${id}` as a `URL` for a single-resource GET, guarding against
   * inputs that WHATWG `URL` parsing would resolve away rather than treat as a path segment:
   * blank/whitespace-only strings, and dot-segments (`.`/`..`) — `encodeURIComponent` doesn't
   * escape `.`, so `new URL(...)` still collapses them, silently retargeting the request to this
   * resource's own `index` route (or, for `..`, an unrelated path entirely) instead of 404ing.
   * Verifies the built URL's `pathname` still ends with the exact encoded `id` to catch both.
   *
   * @param errorMessage Thrown verbatim on a rejected `id`, e.g.
   *   `"getFeedback: id must be a non-empty string"`, so each caller keeps its own wording.
   * @throws Error if `id` is blank, not a string, or resolves away via dot-segments.
   */
  protected buildResourceUrl(id: string, errorMessage: string): URL {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error(errorMessage);
    }
    const encodedId = encodeURIComponent(id);
    const url = new URL(`${this.apiEndpoint}/${encodedId}`);
    if (!url.pathname.endsWith(`/${encodedId}`)) {
      throw new Error(errorMessage);
    }
    return url;
  }

  /**
   * Build a {@link Pagination} from the `X-Page`/`X-Per-Page`/`X-Total-Count`/`X-Total-Pages`
   * response headers the paginated v2 list endpoints set, for endpoints that render a bare array
   * on the wire and carry pagination in headers rather than a body envelope — currently
   * `LoggingService#searchLogs` and `TemplateService#searchTemplates`.
   *
   * `/llm_request_templates` always sends these headers. `/llm_request_logs` sends `X-Total-Count`/
   * `X-Total-Pages` only when the caller opts in with `include_total`, so the header-less branches
   * below derive a defensible result from `items`/`params` instead of falsely reporting zero.
   *
   * @param items The page of results actually returned, used as evidence for the fallbacks below.
   * @param params The caller's requested `page`/`per`, used only as fallback values.
   */
  protected paginationFromHeaders(
    headers: Headers,
    items: readonly unknown[],
    params: { page?: number; per?: number }
  ): Pagination {
    // DEFAULT_PER_PAGE/MAX_PER_PAGE on the v2 list controllers (25/100 on both
    // /llm_request_logs and /llm_request_templates) — mirrored here only for the fallback below;
    // once X-Total-Count is present, the server's real values are used directly instead.
    const DEFAULT_PER_PAGE = 25;
    const MAX_PER_PAGE = 100;

    // Math.trunc (not Math.floor) on `per` to match how the server coerces it — `per_page` does
    // `(params[:per] || params[:per_page]).to_i`, and Ruby's String#to_i truncates toward zero
    // (e.g. "-5.5" -> -5, not -6). `page` gets no equivalent server-side coercion — will_paginate
    // raises on a non-positive/non-integer page rather than clamping it — so `requestedPage` below
    // is truncated/clamped purely to keep this SDK's own fallback `Pagination` object sane, not to
    // mirror server behavior. `params.page`/`params.per` are typed `number`, so a caller-supplied
    // `NaN` is type-legal; `Math.max(1, NaN)` is `NaN`, not `1`, so that's guarded explicitly
    // rather than relying on the clamp.
    const truncatedPage = Math.trunc(params.page ?? 1);
    const requestedPage = Number.isFinite(truncatedPage) ? Math.max(1, truncatedPage) : 1;
    const truncatedPer = Math.trunc(params.per ?? 0);
    const requestedPer = truncatedPer > 0 ? Math.min(truncatedPer, MAX_PER_PAGE) : DEFAULT_PER_PAGE;
    const hasTotalCount = headers.get('x-total-count') !== null;

    const currentPage = Math.max(1, parseHeaderInt(headers.get('x-page'), requestedPage));
    const perPage = parseHeaderInt(headers.get('x-per-page'), requestedPer);

    let totalCount: number;
    let totalPages: number;
    let hasNextPage: boolean;
    let hasPrevPage: boolean;

    if (hasTotalCount) {
      totalCount = parseHeaderInt(headers.get('x-total-count'), items.length);
      // Fall back to a value derived from totalCount (not e.g. currentPage) if X-Total-Pages is
      // itself missing/malformed — a fallback unrelated to the real count could under-report the
      // page count and truncate a caller's pagination loop, exactly what totalCount's own
      // fallback (items.length above) exists to avoid on the sibling header.
      totalPages = parseHeaderInt(
        headers.get('x-total-pages'),
        perPage > 0 ? Math.ceil(totalCount / perPage) : (totalCount > 0 ? 1 : 0)
      );
      hasNextPage = currentPage < totalPages;
      // These backends paginate via will_paginate (not Kaminari — ActiveRecord::Relation#page is
      // will_paginate's; Kaminari is only used elsewhere, on plain arrays), whose `previous_page`
      // has no out-of-range check: `current_page > 1 ? ... : nil`. Match that exactly (no
      // `&& currentPage <= totalPages` guard) for genuine parity with searchFeedback's
      // `previous_page.present?`, rather than inventing stricter semantics no backend here
      // actually implements.
      hasPrevPage = currentPage > 1;
    } else if (items.length > 0) {
      // Rather than let a missing/malformed header silently report total_count: 0 alongside a
      // non-empty page, total_count/total_pages fall back to a lower-bound estimate: every prior
      // page assumed full, plus this page's actual result count. This bound is sound specifically
      // *because* `items` is non-empty — offset-based pagination (`OFFSET (page-1)*per LIMIT per`)
      // can only return rows if that many preceding rows exist, so a real result at `currentPage`
      // proves at least `(currentPage - 1) * perPage` prior rows exist regardless of how large
      // `currentPage` is. It's still only ever a lower bound though — NOT reliable enough to
      // derive has_next_page/has_prev_page from (a full page doesn't prove there's nothing beyond
      // it), so has_next_page is derived independently: a full page implies there may be more.
      totalCount = perPage > 0 ? (currentPage - 1) * perPage + items.length : items.length;
      totalPages = perPage > 0 ? Math.ceil(totalCount / perPage) : currentPage;
      hasNextPage = perPage > 0 && items.length >= perPage;
      hasPrevPage = currentPage > 1;
    } else {
      // An EMPTY page proves the opposite of a non-empty one: it means `currentPage` is at or past
      // the end (or the search matched nothing at all), not that `(currentPage - 1) * perPage`
      // prior rows exist — extrapolating from `currentPage` here would fabricate a total governed
      // entirely by whatever `page` the caller happened to pass (e.g. `page: 1000000` -> a
      // fictitious ~25M-row total). With no evidence of how many real rows exist, report what we
      // can actually confirm: none, on this page.
      totalCount = 0;
      totalPages = 0;
      hasNextPage = false;
      // Still page-relative, not result-relative: a caller can always step back toward page 1
      // regardless of whether this specific page happened to come back empty.
      hasPrevPage = currentPage > 1;
    }

    return {
      current_page: currentPage,
      per_page: perPage,
      total_count: totalCount,
      total_pages: totalPages,
      has_next_page: hasNextPage,
      has_prev_page: hasPrevPage
    };
  }

  protected log(...args: any[]): void {
    if (!this.silent) {
      console.log(...args);
    }
  }

  protected logSeparator(): void {
    if (!this.silent) {
      console.log('═'.repeat(60));
    }
  }

  public getApiEndpoint(): string {
    return this.apiEndpoint;
  }
}