import * as https from 'https';
import * as http from 'http';
import { getCollectorString, CollectionMethod } from '../utils/collector.js';

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
 * Thrown by {@link BaseService.fetchOrThrow} on a non-2xx response. Carries the HTTP `status` so
 * callers (e.g. the CLI) can react to it — a 401 vs. a 404 — without parsing the message string.
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
      body: JSON.stringify(payload)
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

        if (response.ok) {
          const result = await response.json() as T;
          this.log(successMessage);
          return result;
        } else {
          const errorText = await response.text();
          console.error(`❌ Request failed: ${response.status} - ${errorText}`);
          return null;
        }
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
   * Fetch `url` and return the raw response body text, throwing on failure. Used by services that
   * throw-on-error (as opposed to {@link sendRequest}'s POST/null-on-error convention) — e.g.
   * `McpService.mcpCall` and, via {@link getJson}, the `FeedbackService`/`LoggingService` read
   * methods — so the fetch/error/status-throwing logic isn't duplicated in each service.
   *
   * @param errorPrefix Prefixes thrown error messages, e.g. `"MCP request failed"` or
   *   `"Feedback request failed"`, so each caller keeps its own established message wording.
   * @throws Error if global `fetch` is unavailable (Node.js < 18) or on a network failure.
   *   {@link HttpError} (with `.status`) on a non-2xx response.
   */
  protected async fetchOrThrow(url: string, init: RequestInit, errorPrefix: string): Promise<string> {
    if (typeof fetch === 'undefined') {
      throw new Error(`${errorPrefix}: global fetch is unavailable (requires Node.js 18+)`);
    }

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      throw new Error(`${errorPrefix}: ${(err as Error).message}`, { cause: err });
    }

    const text = await res.text().catch(() => '');
    if (!res.ok) {
      throw new HttpError(`${errorPrefix} (${res.status}): ${text.slice(0, 2000)}`, res.status);
    }
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
    const text = await this.fetchOrThrow(
      url,
      { method: 'GET', headers: { Accept: 'application/json', 'X-API-Key': this.apiKey } },
      `${noun} request failed`
    );

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`${noun} response was not valid JSON: ${text.slice(0, 2000)}`);
    }
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