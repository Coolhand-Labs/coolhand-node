import { HelpCenterDocsService, HelpCenterDocsServiceConfig } from '../src/services/HelpCenterDocsService';
import { Coolhand } from '../src/coolhand';
import { HelpArticleSummary } from '../src/types';

const originalFetch = (global as any).fetch;
const originalEnvKey = process.env.COOLHAND_API_KEY;

function buildSummary(overrides: Partial<HelpArticleSummary> = {}): HelpArticleSummary {
  return {
    slug: 'what-is-feedback-match-rate',
    title: 'What is feedback match rate?',
    answer: null,
    article_kind: 'concept',
    tags: ['feedback'],
    category: 'feedback-and-prompts',
    url: 'https://coolhandlabs.com/help/what-is-feedback-match-rate',
    markdown_url: 'https://coolhandlabs.com/help/what-is-feedback-match-rate.md',
    reading_time_minutes: null,
    search_headline: null,
    published_at: null,
    updated_content_at: null,
    ...overrides
  };
}

function mockFetch(
  bodyObj: unknown,
  { ok = true, status = 200, headers = {} }: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}
): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok,
    status,
    text: jest.fn().mockResolvedValue(typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj)),
    headers: new Headers(headers)
  });
  (global as any).fetch = fn;
  return fn;
}

const lastUrl = (fn: jest.Mock): URL => new URL(fn.mock.calls[fn.mock.calls.length - 1][0]);
const lastHeaders = (fn: jest.Mock): Record<string, string> => fn.mock.calls[fn.mock.calls.length - 1][1].headers;

function newService(overrides: HelpCenterDocsServiceConfig = {}): HelpCenterDocsService {
  return new HelpCenterDocsService(overrides);
}

describe('HelpCenterDocsService', () => {
  beforeEach(() => {
    delete process.env.COOLHAND_API_KEY;
  });

  afterEach(() => {
    (global as any).fetch = originalFetch;
    if (originalEnvKey === undefined) {
      delete process.env.COOLHAND_API_KEY;
    } else {
      process.env.COOLHAND_API_KEY = originalEnvKey;
    }
  });

  it('constructs with no arguments and targets the public_content collection', () => {
    expect(newService().getApiEndpoint()).toBe('https://coolhandlabs.com/api/v2/public_content');
  });

  describe('auth header', () => {
    it('sends no X-API-Key header when no key is configured', async () => {
      const fetchMock = mockFetch([]);

      await newService().searchHelpArticles();

      expect(lastHeaders(fetchMock)).toEqual({ Accept: 'application/json' });
    });

    it('sends the configured key as X-API-Key', async () => {
      const fetchMock = mockFetch([]);

      await newService({ apiKey: 'key-123' }).searchHelpArticles();

      expect(lastHeaders(fetchMock)['X-API-Key']).toBe('key-123');
    });

    it('falls back to COOLHAND_API_KEY, with an explicit apiKey taking precedence', async () => {
      process.env.COOLHAND_API_KEY = 'env-key';
      const fetchMock = mockFetch([]);

      await newService().listHelpCategories();
      expect(lastHeaders(fetchMock)['X-API-Key']).toBe('env-key');

      await newService({ apiKey: 'explicit-key' }).listHelpCategories();
      expect(lastHeaders(fetchMock)['X-API-Key']).toBe('explicit-key');
    });

    it('treats an explicit empty apiKey as no key, without reading COOLHAND_API_KEY', async () => {
      process.env.COOLHAND_API_KEY = 'env-key';
      const fetchMock = mockFetch([]);

      await newService({ apiKey: '' }).getHelpArticle('a-slug').catch(() => undefined);

      expect(lastHeaders(fetchMock)).not.toHaveProperty('X-API-Key');
    });

    it('constructs anonymously with no key, an empty key, or a whitespace-only key', () => {
      expect(() => newService()).not.toThrow();
      expect(() => newService({ apiKey: '' })).not.toThrow();
      expect(() => newService({ apiKey: '  \n' })).not.toThrow();
    });

    it('still rejects a non-empty key that is not a legal header value', () => {
      expect(() => newService({ apiKey: 'bad\nkey' })).toThrow(/not valid in an HTTP header/);
      expect(() => newService({ apiKey: 123 as unknown as string })).toThrow('apiKey must be a non-empty string');
      expect(() => newService({ apiKey: null as unknown as string })).not.toThrow();
    });

    it('leaves error messages intact when there is no key to mask', async () => {
      mockFetch('Rate limit exceeded.', { ok: false, status: 429 });

      await expect(newService().searchHelpArticles()).rejects.toThrow('Help center request failed (429): Rate limit exceeded.');
    });

    it('surfaces a 401 for an invalid key rather than retrying anonymously', async () => {
      const fetchMock = mockFetch({ error: 'Invalid API key.' }, { ok: false, status: 401 });

      await expect(newService({ apiKey: 'bad' }).searchHelpArticles()).rejects.toMatchObject({
        name: 'HttpError',
        status: 401
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('surfaces the anonymous rate limit as a 429', async () => {
      mockFetch({ error: 'Rate limit exceeded.' }, { ok: false, status: 429 });

      await expect(newService().searchHelpArticles()).rejects.toMatchObject({ name: 'HttpError', status: 429 });
    });
  });

  describe('searchHelpArticles', () => {
    it('sends no query params when called with no arguments', async () => {
      const fetchMock = mockFetch([]);

      await newService().searchHelpArticles();

      expect(lastUrl(fetchMock).toString()).toBe('https://coolhandlabs.com/api/v2/public_content');
    });

    it('sends query as the string q, with page and per_page', async () => {
      const fetchMock = mockFetch([]);

      await newService().searchHelpArticles({ query: 'match rate', page: 2, perPage: 5 });

      const params = lastUrl(fetchMock).searchParams;
      expect(params.get('q')).toBe('match rate');
      expect(params.get('page')).toBe('2');
      expect(params.get('per_page')).toBe('5');
    });

    it('omits a blank query', async () => {
      const fetchMock = mockFetch([]);

      await newService().searchHelpArticles({ query: '   ' });

      expect(lastUrl(fetchMock).search).toBe('');
    });

    it('sends category alone as the structured q[help_category_slug_eq] form, bracket-encoded', async () => {
      const fetchMock = mockFetch([]);

      await newService().searchHelpArticles({ category: 'providers' });

      const url = lastUrl(fetchMock);
      expect(url.search).toBe('?q%5Bhelp_category_slug_eq%5D=providers');
      expect(url.searchParams.has('q')).toBe(false);
    });

    it('moves query to q[full_text] when category is given, and never sends the plain q', async () => {
      const fetchMock = mockFetch([]);

      await newService().searchHelpArticles({ category: 'providers', query: 'anthropic', perPage: 3 });

      const url = lastUrl(fetchMock);
      expect(url.search).toContain('q%5Bfull_text%5D=anthropic');
      expect(url.search).toContain('q%5Bhelp_category_slug_eq%5D=providers');
      expect(url.searchParams.get('q')).toBeNull();
      expect(url.searchParams.get('per_page')).toBe('3');
    });

    it('treats a blank category as omitted', async () => {
      const fetchMock = mockFetch([]);

      await newService().searchHelpArticles({ category: '  ', query: 'x' });

      expect(lastUrl(fetchMock).search).toBe('?q=x');
    });

    it('trims surrounding whitespace from query before sending it', async () => {
      const fetchMock = mockFetch([]);

      await newService().searchHelpArticles({ query: '  match rate ' });

      expect(lastUrl(fetchMock).searchParams.get('q')).toBe('match rate');
    });

    it('trims surrounding whitespace from category before sending it', async () => {
      const fetchMock = mockFetch([]);

      await newService().searchHelpArticles({ category: '  providers ' });

      expect(lastUrl(fetchMock).searchParams.get('q[help_category_slug_eq]')).toBe('providers');
    });

    it('trims both query and category when sent together in the structured form', async () => {
      const fetchMock = mockFetch([]);

      await newService().searchHelpArticles({ query: ' match rate ', category: ' providers ' });

      const url = lastUrl(fetchMock);
      expect(url.searchParams.get('q[full_text]')).toBe('match rate');
      expect(url.searchParams.get('q[help_category_slug_eq]')).toBe('providers');
      expect(url.searchParams.has('q')).toBe(false);
    });

    it('never sends a corpus or plain category param', async () => {
      const fetchMock = mockFetch([]);

      await newService().searchHelpArticles({ category: 'providers', query: 'x', corpus: 'help' } as any);

      expect(lastUrl(fetchMock).searchParams.has('category')).toBe(false);
      expect(lastUrl(fetchMock).searchParams.has('corpus')).toBe(false);
    });

    it('returns the articles and reads pagination off the response headers', async () => {
      const article = buildSummary({ search_headline: '<mark>Match</mark> rate' });
      mockFetch([article], {
        headers: { 'X-Page': '2', 'X-Per-Page': '2', 'X-Total-Count': '14', 'X-Total-Pages': '7' }
      });

      const { articles, pagination } = await newService().searchHelpArticles({ query: 'match rate', page: 2, perPage: 2 });

      expect(articles).toEqual([article]);
      expect(pagination).toEqual({
        current_page: 2,
        per_page: 2,
        total_count: 14,
        total_pages: 7,
        has_next_page: true,
        has_prev_page: true
      });
    });

    it('reports an empty page as zero results', async () => {
      mockFetch([], { headers: { 'X-Page': '1', 'X-Per-Page': '25', 'X-Total-Count': '0', 'X-Total-Pages': '0' } });

      const { articles, pagination } = await newService().searchHelpArticles({ query: 'zzz' });

      expect(articles).toEqual([]);
      expect(pagination.total_count).toBe(0);
      expect(pagination.has_next_page).toBe(false);
    });
  });

  describe('getHelpArticle', () => {
    it('GETs /:slug and returns the article with its body', async () => {
      const article = { ...buildSummary(), body: '# Hello', noindex: false, toc: [] };
      const fetchMock = mockFetch(article);

      await expect(newService().getHelpArticle('what-is-feedback-match-rate')).resolves.toEqual(article);

      expect(lastUrl(fetchMock).pathname).toBe('/api/v2/public_content/what-is-feedback-match-rate');
    });

    it('percent-encodes the slug as one path segment', async () => {
      const fetchMock = mockFetch({});

      await newService().getHelpArticle('a/b c');

      expect(lastUrl(fetchMock).pathname).toBe('/api/v2/public_content/a%2Fb%20c');
    });

    it.each(['', '   ', '.', '..'])('rejects %j before issuing a request', async (slug) => {
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      await expect(newService().getHelpArticle(slug)).rejects.toThrow('slug must be a non-empty string');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws an HttpError carrying 404 for an unknown slug', async () => {
      mockFetch({ error: 'Not found' }, { ok: false, status: 404 });

      await expect(newService().getHelpArticle('nope')).rejects.toMatchObject({ name: 'HttpError', status: 404 });
    });
  });

  describe('listHelpCategories', () => {
    it('GETs /categories and returns the sections', async () => {
      const categories = [
        { slug: 'providers', name: 'Provider guides', description: 'd', url_prefix: '/help', allowed_tags: null },
        { slug: 'updates', name: 'Product updates', description: 'd', url_prefix: '/updates', allowed_tags: ['open_source'] }
      ];
      const fetchMock = mockFetch(categories);

      await expect(newService().listHelpCategories()).resolves.toEqual(categories);

      expect(lastUrl(fetchMock).pathname).toBe('/api/v2/public_content/categories');
    });
  });
});

describe('Coolhand help center methods', () => {
  afterEach(() => {
    (global as any).fetch = originalFetch;
    if (originalEnvKey === undefined) {
      delete process.env.COOLHAND_API_KEY;
    } else {
      process.env.COOLHAND_API_KEY = originalEnvKey;
    }
  });

  it('delegate to the service and send the instance key, not COOLHAND_API_KEY', async () => {
    process.env.COOLHAND_API_KEY = 'env-key';
    const fetchMock = mockFetch([]);
    const coolhand = new Coolhand({ apiKey: 'instance-key', baseUrl: 'http://localhost:3000' });

    await coolhand.searchHelpArticles({ query: 'x' });
    expect(lastUrl(fetchMock).toString()).toBe('http://localhost:3000/api/v2/public_content?q=x');
    expect(lastHeaders(fetchMock)['X-API-Key']).toBe('instance-key');

    await coolhand.listHelpCategories();
    expect(lastUrl(fetchMock).pathname).toBe('/api/v2/public_content/categories');

    await coolhand.getHelpArticle('a-slug');
    expect(lastUrl(fetchMock).pathname).toBe('/api/v2/public_content/a-slug');
  });
});
