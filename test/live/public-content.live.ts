/**
 * End-to-end proof of the help center reads against a REAL Coolhand server. Nothing is mocked.
 * Unlike the other live suites this one needs no API key — reads are open — so it deliberately
 * constructs the service without one. The keyed path is covered by the unit tests.
 *
 * Run it with `COOLHAND_LIVE_BASE_URL=http://127.0.0.1:3111 npx jest --config jest.live.config.cjs --runInBand --testPathPatterns test/live/public-content`.
 * Anonymous callers are limited to 30 requests per minute per IP and this suite makes about 10, so
 * re-running it back to back can hit a 429 that has nothing to do with the wrapper.
 */
import { HttpError } from '../../src/services/BaseService';
import { PublicContentService } from '../../src/services/PublicContentService';
import { HelpArticle, HelpArticleSummary, HelpCategory } from '../../src/types';

const baseUrl = process.env.COOLHAND_LIVE_BASE_URL;
if (!baseUrl) {
  throw new Error('Live tests need COOLHAND_LIVE_BASE_URL in the environment. Set it and re-run `npm run test:live`.');
}

// The env fallback would otherwise make a "no key" client send COOLHAND_API_KEY.
delete process.env.COOLHAND_API_KEY;
const anonymous = new PublicContentService({ baseUrl });

function expectNullableString(value: unknown): void {
  expect(value === null || typeof value === 'string').toBe(true);
}

function expectSummaryShape(article: HelpArticleSummary): void {
  expect(typeof article.slug).toBe('string');
  expect(typeof article.title).toBe('string');
  expectNullableString(article.answer);
  expect(['reference', 'concept', 'how_to', 'troubleshooting', 'faq_answer', 'release_note']).toContain(article.article_kind);
  expect(Array.isArray(article.tags)).toBe(true);
  expect(typeof article.category).toBe('string');
  expect(typeof article.url).toBe('string');
  expect(typeof article.markdown_url).toBe('string');
  expect(article.reading_time_minutes === null || Number.isInteger(article.reading_time_minutes)).toBe(true);
  expectNullableString(article.search_headline);
  expectNullableString(article.published_at);
  expectNullableString(article.updated_content_at);
}

describe('PublicContentService against a live server, with no API key', () => {
  it('lists articles and reads pagination off the response headers', async () => {
    const { articles, pagination } = await anonymous.searchHelpArticles({ perPage: 2 });

    expect(articles.length).toBeGreaterThan(0);
    expect(articles.length).toBeLessThanOrEqual(2);
    articles.forEach(expectSummaryShape);
    for (const article of articles) {
      expect(article).not.toHaveProperty('body');
      expect(article.search_headline).toBeNull();
    }
    expect(pagination.current_page).toBe(1);
    expect(pagination.per_page).toBe(2);
    expect(pagination.total_count).toBeGreaterThanOrEqual(articles.length);
    expect(pagination.total_pages).toBe(Math.ceil(pagination.total_count / 2));
    expect(pagination.has_next_page).toBe(pagination.total_pages > 1);
  });

  it('ranks a relevance search and returns <mark> headlines', async () => {
    const { articles, pagination } = await anonymous.searchHelpArticles({ query: 'match rate', perPage: 2 });

    expect(articles.length).toBeGreaterThan(0);
    expect(pagination.per_page).toBe(2);
    expect(pagination.total_count).toBeGreaterThanOrEqual(articles.length);
    expect(articles.some((article) => article.search_headline?.includes('<mark>'))).toBe(true);
  });

  it('pages through results', async () => {
    const first = await anonymous.searchHelpArticles({ perPage: 1, page: 1 });
    const second = await anonymous.searchHelpArticles({ perPage: 1, page: 2 });

    expect(second.pagination.current_page).toBe(2);
    expect(second.pagination.has_prev_page).toBe(true);
    expect(second.articles[0].slug).not.toBe(first.articles[0].slug);
  });

  it('filters by category through the structured q[...] form, with and without a query', async () => {
    const categories = await anonymous.listHelpCategories();
    const section = categories.find((category) => category.url_prefix === '/help');
    if (!section) {
      throw new Error('expected at least one /help section on the server');
    }

    const inSection = await anonymous.searchHelpArticles({ category: section.slug, perPage: 100 });
    expect(inSection.articles.length).toBeGreaterThan(0);
    for (const article of inSection.articles) {
      expect(article.category).toBe(section.slug);
    }
    const all = await anonymous.searchHelpArticles({ perPage: 1 });
    expect(inSection.pagination.total_count).toBeLessThan(all.pagination.total_count);

    const combined = await anonymous.searchHelpArticles({ category: section.slug, query: 'feedback' });
    expect(combined.pagination.total_count).toBeLessThanOrEqual(inSection.pagination.total_count);
    for (const article of combined.articles) {
      expect(article.category).toBe(section.slug);
    }
  });

  it('shows one article with its markdown body and toc', async () => {
    const { articles } = await anonymous.searchHelpArticles({ perPage: 1 });

    const article: HelpArticle = await anonymous.getHelpArticle(articles[0].slug);

    expect(article.slug).toBe(articles[0].slug);
    expect(article.body.length).toBeGreaterThan(0);
    expect(typeof article.noindex).toBe('boolean');
    expect(Array.isArray(article.toc)).toBe(true);
    expect(article).not.toHaveProperty('search_headline');
  });

  it('throws an HttpError carrying 404 for an unknown slug', async () => {
    await expect(anonymous.getHelpArticle('definitely-not-a-real-article')).rejects.toMatchObject({
      name: 'HttpError',
      status: 404
    });
  });

  it('lists the categories with their tag vocabulary', async () => {
    const categories: HelpCategory[] = await anonymous.listHelpCategories();

    expect(categories.length).toBeGreaterThan(0);
    for (const category of categories) {
      expect(typeof category.slug).toBe('string');
      expect(typeof category.name).toBe('string');
      expect(typeof category.description).toBe('string');
      expect(['/help', '/updates']).toContain(category.url_prefix);
      expect(category.allowed_tags === null || Array.isArray(category.allowed_tags)).toBe(true);
    }
  });

  it('gives a 401 for an invalid key instead of falling back to anonymous', async () => {
    const service = new PublicContentService({ baseUrl, apiKey: 'not-a-real-key' });

    const error = await service.listHelpCategories().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(401);
  });
});
