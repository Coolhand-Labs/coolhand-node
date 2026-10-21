# Reading the Help Center

`HelpCenterDocsService` reads Coolhand's help center: the articles served at `coolhandlabs.com/help/:slug`
and the posts at `/updates/:slug`. "Help center" is the user-facing name; on the wire the resource is
`public_content` (`GET /api/v2/public_content`, `/:slug` and `/categories`). It is read-only —
creating, updating and archiving articles is Coolhand-internal and not wrapped.

**Auth:** none required. Unlike every other service, this one can be constructed with no key, and
without a `Coolhand` instance (whose constructor requires one):

```typescript
import { HelpCenterDocsService } from 'coolhand-node';

const helpCenter = new HelpCenterDocsService();                 // anonymous
const keyed = new HelpCenterDocsService({ apiKey: 'any-key' }); // lifts the rate limit
```

- No key is configured: no `X-API-Key` header is sent, and the calls work. Anonymous callers are
  limited to **30 requests per minute per IP**; beyond that the server answers `429`.
- A key is sent as `X-API-Key` when `apiKey` is passed, else when `COOLHAND_API_KEY` is set. Pass `apiKey: ''` to force an anonymous call even when `COOLHAND_API_KEY` is set (for example when pointing `baseUrl` at a host that key was not issued for). Callers
  with a valid key are not rate limited.
- A key the server does not recognise is a `401` (`{"error":"Invalid API key."}`) even though the
  endpoint is public. It is thrown, not retried anonymously.

A `Coolhand` instance exposes the same methods (`coolhand.searchHelpArticles(...)` etc.) and sends its
own key.

## `searchHelpArticles(params)`

```typescript
const { articles, pagination } = await helpCenter.searchHelpArticles({
  query: 'match rate',
  category: 'feedback-and-prompts',
  perPage: 10
});
```

`params: SearchHelpArticlesParams` — all optional:

| Field | Type | Description |
|---|---|---|
| `query` | `string` | Relevance search (Postgres full text, the same as the website's). Supports quoted phrases, `-exclusions` and `or`. Omit for a full listing. Surrounding whitespace is trimmed; a blank string is treated as omitted |
| `category` | `string` | Restrict to one section by slug (see `listHelpCategories`). Surrounding whitespace is trimmed; a blank string is treated as omitted |
| `page` | `number` | Page number, 1-based |
| `perPage` | `number` | Page size (default 25, max 100) |

The endpoint has no `category` parameter. `category` is sent in its structured form instead, which
also moves the relevance search to a different key; the plain `q=...` string and the `q[...]` form
cannot be mixed:

| `query` | `category` | Sent |
|---|---|---|
| set | unset | `q=<query>` |
| unset | set | `q[help_category_slug_eq]=<category>` |
| set | set | `q[help_category_slug_eq]=<category>&q[full_text]=<query>` |

### Return value

`Promise<SearchHelpArticlesResponse>` — `{ articles, pagination }`. Each article is a
`HelpArticleSummary`; the markdown `body` is omitted from lists:

```typescript
{
  slug: 'what-is-feedback-match-rate',
  title: 'What is feedback match rate?',
  answer: 'Match rate is the share of ...',  // string | null
  article_kind: 'concept',   // reference | concept | how_to | troubleshooting | faq_answer | release_note
  tags: ['feedback', 'matching'],
  category: 'feedback-and-prompts',          // section slug
  url: 'https://coolhandlabs.com/help/what-is-feedback-match-rate',
  markdown_url: 'https://coolhandlabs.com/help/what-is-feedback-match-rate.md',
  reading_time_minutes: 10,                  // number | null
  search_headline: '<mark>Match</mark> <mark>rate</mark> is ...', // null on a plain listing
  published_at: '2026-08-30T13:57:52Z',      // string | null
  updated_content_at: '2026-08-30T13:57:52Z' // string | null
}
```

`search_headline` is the matching passage with `<mark>` tags around the matched terms, so you can see
why something matched without fetching the body.

`pagination` is read from the `X-Page`/`X-Per-Page`/`X-Total-Count`/`X-Total-Pages` response headers
and has the same shape as the other read methods (`current_page`, `per_page`, `total_count`,
`total_pages`, `has_next_page`, `has_prev_page`).

## `getHelpArticle(slug)`

```typescript
const article = await helpCenter.getHelpArticle('what-is-feedback-match-rate');
article.body; // full markdown
article.toc;  // [{ id, text, level, children }]
```

Returns a `HelpArticle`: the summary fields minus `search_headline`, plus `body` (full markdown),
`noindex` (boolean) and `toc` (the heading structure, h3s nested under their h2). Throws before any
request if `slug` is blank or a bare `.`/`..`. An unknown or unpublished slug throws an `HttpError`
with `status: 404`.

## `listHelpCategories()`

```typescript
const categories = await helpCenter.listHelpCategories();
// [{ slug: 'providers', name: 'Provider guides', description: '...', url_prefix: '/help', allowed_tags: null }, ...]
```

Returns `HelpCategory[]`: `slug` (the `category` filter above), `name`, `description`, `url_prefix`
(`/help` or `/updates`) and `allowed_tags` (the only tags the section accepts; `null` means any tag).

## Errors

All three throw on network failure or a non-JSON body. A non-2xx response throws an `HttpError`
whose `status` holds the HTTP status code: `401` for an invalid key, `404` for an unknown slug,
`429` when the anonymous rate limit is exceeded.

## Verifying against a live server

`test/live/help-center-docs.live.ts` runs against a real server with no key:

```bash
COOLHAND_LIVE_BASE_URL=http://127.0.0.1:3111 npx jest --config jest.live.config.cjs --runInBand --testPathPatterns 'test/live/help-center-docs'
```

It makes about thirteen anonymous requests, so running it repeatedly within a minute can hit the `429`.
