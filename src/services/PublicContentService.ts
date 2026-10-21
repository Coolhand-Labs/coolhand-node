import {
  HelpArticle,
  HelpArticleSummary,
  HelpCategory,
  SearchHelpArticlesParams,
  SearchHelpArticlesResponse
} from '../types.js';
import { BaseService, BaseServiceConfig } from './BaseService.js';

export interface PublicContentServiceConfig extends Omit<BaseServiceConfig, 'apiKey' | 'silent'> {
  /**
   * Optional: reads need no key. When omitted, falls back to `COOLHAND_API_KEY` (so with a custom
   * `baseUrl` that key goes to that host); with neither, no key header is sent. An explicit `''` means
   * "no key" and skips the environment fallback.
   */
  apiKey?: string;
  silent?: boolean;
}

function keyFromEnv(): string | undefined {
  return typeof process !== 'undefined' ? process.env.COOLHAND_API_KEY : undefined;
}

/**
 * Read-only access to the Coolhand help center — the `public_content` endpoints
 * (`GET /api/v2/public_content`, `/:slug` and `/categories`), the same pages served at
 * `/help/:slug` and `/updates/:slug`. "Help center" is the user-facing name, "public content" the
 * wire resource. Create/update/archive are Coolhand-internal and deliberately not wrapped.
 *
 * Unlike every other service, this one works with no API key, so it can be constructed on its own
 * (`new PublicContentService()`) rather than through `Coolhand`, whose constructor requires a key.
 * Anonymous callers are rate limited to 30 requests per minute per IP (`429` beyond that); a key —
 * `apiKey`, else `COOLHAND_API_KEY` when `apiKey` is omitted — is sent as `X-API-Key` and lifts the limit. A key the server
 * does not recognise is a `401`, not a silent fallback to anonymous.
 */
export class PublicContentService extends BaseService {
  constructor(config: PublicContentServiceConfig = {}) {
    super(
      { ...config, apiKey: config.apiKey ?? keyFromEnv() ?? '', silent: config.silent ?? true },
      '/api/v2/public_content'
    );
  }

  /**
   * Search or list published articles. With `query`, results are relevance-ranked (the same
   * Postgres full-text search the website uses) and each carries a `search_headline`; without it,
   * the full listing.
   *
   * `category` filters to one section. The endpoint has no `category` parameter, so it is sent in
   * its structured form: `q[help_category_slug_eq]=<category>`, with `query` moving to
   * `q[full_text]`. The plain string `q` and the `q[...]` form cannot be mixed, hence the switch.
   *
   * @returns `{ articles, pagination }` — `pagination` is read from the `X-Page`/`X-Per-Page`/
   *   `X-Total-Count`/`X-Total-Pages` response headers.
   * @throws Error on network failure or a non-JSON body. A non-2xx response throws an
   *   {@link HttpError} whose `status` holds the HTTP status code (`401` invalid key, `429`
   *   anonymous rate limit exceeded).
   */
  public async searchHelpArticles(params: SearchHelpArticlesParams = {}): Promise<SearchHelpArticlesResponse> {
    const url = new URL(this.apiEndpoint);
    const query = params.query?.trim() || undefined;
    const category = params.category?.trim();
    if (category) {
      this.setQueryParams(url, { 'q[help_category_slug_eq]': category, 'q[full_text]': query });
    } else {
      this.setQueryParams(url, { q: query });
    }
    this.setQueryParams(url, { page: params.page, per_page: params.perPage });

    const { body, headers } = await this.getJsonWithHeaders<HelpArticleSummary[]>(url.toString(), 'Help center');
    return {
      articles: body,
      pagination: this.paginationFromHeaders(headers, body, { page: params.page, per: params.perPage })
    };
  }

  /**
   * Fetch one published article by slug, including its full markdown `body` and `toc`.
   *
   * @throws Error if `slug` is blank/whitespace-only or a bare dot-segment (`.`/`..`), on network
   *   failure or a non-JSON body. A non-2xx response throws an {@link HttpError} whose `status`
   *   holds the HTTP status code (`404` for an unknown or unpublished slug).
   */
  public async getHelpArticle(slug: string): Promise<HelpArticle> {
    const url = this.buildResourceUrl(slug, 'getHelpArticle: slug must be a non-empty string');
    return this.getJson<HelpArticle>(url.toString(), 'Help center');
  }

  /**
   * List every section articles are filed under, with its URL prefix and tag vocabulary. Use a
   * section's `slug` as `category` on {@link searchHelpArticles}.
   *
   * @throws Error on network failure or a non-JSON body. A non-2xx response throws an
   *   {@link HttpError} whose `status` holds the HTTP status code.
   */
  public async listHelpCategories(): Promise<HelpCategory[]> {
    return this.getJson<HelpCategory[]>(`${this.apiEndpoint}/categories`, 'Help center');
  }
}
