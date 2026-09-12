import {
  LlmReferencedFile,
  LlmReferenceSession,
  SearchReferencedFilesParams,
  SearchReferencedFilesResponse,
  ListReferencedFileSessionsParams,
  ListReferencedFileSessionsResponse
} from '../types';
import { BaseService, BaseServiceConfig } from './BaseService.js';

export interface LlmReferenceServiceConfig extends BaseServiceConfig {}

/**
 * Read-only access to `GET /api/v2/llm_references` and `GET /api/v2/llm_references/sessions`.
 *
 * Both require the client's **private** API key — the public key is write-only on this API and is
 * rejected exactly like an invalid key. There is no create/update/destroy on this surface, and no
 * `GET /api/v2/llm_references/:file_path` show route: file paths contain slashes and aren't safe
 * as a URL path segment, so the per-file drill-down is the `sessions` collection route with a
 * `file_path` query param instead of a member route.
 */
export class LlmReferenceService extends BaseService {
  constructor(config: LlmReferenceServiceConfig) {
    super(config, '/api/v2/llm_references');
  }

  /**
   * List the client's referenced files, aggregated to one row per distinct `file_path`, ranked by
   * `reference_count` descending. Bounded to the last 90 days (`LlmReference::DEFAULT_WINDOW`
   * server-side) — a file referenced only outside that window will not appear.
   *
   * `reference_count`/`last_referenced_at` are computed aggregates (`COUNT(*)`/`MAX(created_at)`),
   * not stored columns — there is no `id` field on this shape at all, which is why `id` is not a
   * supported filter (an unrecognized `q[...]` key is a 422, not silently ignored).
   *
   * @param params Ransack-backed filters (file path substring, created_at range) plus `page`/`per`.
   *   There is no `clientId` — the client is derived from the API key and cannot be supplied.
   * @returns `{ files, pagination }`. The endpoint renders `files` as a bare array on the wire and
   *   always sends `X-Page`/`X-Per-Page`/`X-Total-Count`/`X-Total-Pages`, which `pagination` is
   *   read from — never computed from the array length.
   * @throws Error on network failure or a non-JSON body. A non-2xx response throws an
   *   {@link HttpError} whose `status` holds the HTTP status code: `401` for a missing/invalid/
   *   public key, `422` for an unrecognized Ransack attribute/predicate or a non-scalar param
   *   (e.g. an array/object where a scalar like `page` is expected), and `504` when the aggregate
   *   exceeds the backend's statement timeout — narrow `filePathContains` or reduce `per` and
   *   retry, the same as `TemplateService#searchTemplates`'s `504`.
   */
  public async searchReferencedFiles(
    params: SearchReferencedFilesParams = {}
  ): Promise<SearchReferencedFilesResponse> {
    const url = new URL(this.apiEndpoint);

    const queryParams = {
      'q[file_path_cont]': params.filePathContains,
      'q[created_at_gteq]': params.createdAtGteq,
      'q[created_at_lteq]': params.createdAtLteq,
      page: params.page,
      per: params.per
    };
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const { body, headers } = await this.getJsonWithHeaders<LlmReferencedFile[]>(url.toString(), 'Referenced file');
    return { files: body, pagination: this.paginationFromHeaders(headers, body, params) };
  }

  /**
   * The per-file drill-down {@link searchReferencedFiles} intentionally omits: raw, un-aggregated
   * rows for one exact `file_path`, newest first. There is no member route for this — see the
   * class doc for why — so this hits `/llm_references/sessions?file_path=...` instead.
   *
   * `file_path` is matched exactly, not via Ransack substring — this is a lookup for a path you
   * already have (typically the `file_path` field from a {@link searchReferencedFiles} row), not a
   * search. Bounded to the same 90-day window as {@link searchReferencedFiles}. An unmatched
   * `file_path` returns `200` with an empty array, not a `404`.
   *
   * @param params `filePath` (required, exact match) plus `page`/`per`. A blank string is sent
   *   through to the server as-is and rejected there with `422` (see below), matching the
   *   documented contract; only a non-string value (e.g. an omitted `filePath` on a plain-JS call
   *   that bypasses this method's TypeScript signature) is rejected client-side, since `URL`'s
   *   `searchParams.set` would otherwise coerce `undefined` into the literal query value
   *   `"undefined"` and silently search for that literal path instead.
   * @returns `{ sessions, pagination }`. `llm_request_log_id` on each row is a hashid — feed it to
   *   `getLogContent`/`GET /api/v2/llm_request_logs/{id}` to inspect that session.
   * @throws Error if `filePath` is not a string. Error on network failure or a non-JSON body. A
   *   non-2xx response throws an {@link HttpError} whose `status` holds the HTTP status code: `401`
   *   (same shapes as {@link searchReferencedFiles}), `422` when `filePath` is missing/blank or a
   *   non-scalar value, and `504` when the pagination `COUNT(*)` for this `file_path` exceeds the
   *   backend's statement timeout — no `GROUP BY` aggregate here, but a `file_path` referenced by
   *   very many sessions makes that count as expensive as {@link searchReferencedFiles}'s
   *   aggregate; reduce `per` and retry.
   */
  public async listReferencedFileSessions(
    params: ListReferencedFileSessionsParams
  ): Promise<ListReferencedFileSessionsResponse> {
    if (typeof params.filePath !== 'string') {
      throw new Error('listReferencedFileSessions: filePath must be a string');
    }
    const url = new URL(`${this.apiEndpoint}/sessions`);
    url.searchParams.set('file_path', params.filePath);
    if (params.page !== undefined) {
      url.searchParams.set('page', String(params.page));
    }
    if (params.per !== undefined) {
      url.searchParams.set('per', String(params.per));
    }

    const { body, headers } = await this.getJsonWithHeaders<LlmReferenceSession[]>(
      url.toString(),
      'Referenced file session'
    );
    return { sessions: body, pagination: this.paginationFromHeaders(headers, body, params) };
  }
}
