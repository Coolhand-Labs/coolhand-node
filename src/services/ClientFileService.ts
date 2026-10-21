import {
  ClientFileStatus,
  CoolhandClientFilePayload,
  CoolhandClientFileResponse,
  DownloadedClientFile,
  ListClientFilesParams,
  ListClientFilesResponse
} from '../types';
import { BaseService, BaseServiceConfig } from './BaseService.js';

export interface ClientFileServiceConfig extends BaseServiceConfig {}

function hasBracketOrControlChar(key: string): boolean {
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    if (key[i] === '[' || key[i] === ']' || code < 0x20 || code === 0x7f) { return true; }
  }
  return false;
}

// RFC 6266: `filename*` (RFC 5987, percent-encoded) wins over the plain `filename` parameter.
function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) { return null; }
  const extended = /(?:^|[;\s])filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // Malformed percent-encoding: fall through to the plain parameter.
    }
  }
  const plain = /(?:^|[;\s])filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i.exec(header);
  if (!plain) { return null; }
  const value = plain[1] !== undefined ? plain[1].replace(/\\(.)/g, '$1') : plain[2].trim();
  return value || null;
}

/**
 * Access to `/api/v2/client_files`: upload (`POST`, private key), and the client-admin operations
 * list (`GET`), download (`GET .../{id}/content`) and status change (`PATCH .../{id}`).
 *
 * The three client-admin operations require a **per-user API key** (`ch_priv_...`) belonging to a
 * client admin of the client, configured as `apiKey`. The client-level private key, the public key
 * and OAuth tokens are refused (`403` or `401`), as are keys of non-admin members (`403`). Unlike
 * {@link createClientFile}, which logs and resolves to `null` on failure, these three throw an
 * {@link HttpError} with the HTTP `status` — the read-method convention shared with
 * `TemplateService`.
 */
export class ClientFileService extends BaseService {
  constructor(config: ClientFileServiceConfig) {
    super(config, '/api/v2/client_files');
  }

  public async createClientFile(payload: CoolhandClientFilePayload): Promise<CoolhandClientFileResponse | null> {
    const formData = new FormData();
    formData.append('client_file[name]', payload.name);
    if (payload.file_type) {
      formData.append('client_file[file_type]', payload.file_type);
    }
    if (payload.description) {
      formData.append('client_file[description]', payload.description);
    }
    const filePart = payload.file instanceof Blob ? payload.file : new Blob([new Uint8Array(payload.file)]);
    formData.append('client_file[file]', filePart, payload.filename);
    if (payload.metadata) {
      for (const [key, value] of Object.entries(payload.metadata)) {
        // The key is interpolated into a Rack-style multipart field name, so brackets would open
        // extra nesting levels (`a][b`) and control characters could corrupt the field header.
        if (key === '' || hasBracketOrControlChar(key)) {
          throw new Error(`Invalid client file metadata key ${JSON.stringify(key)}: keys must be non-empty and must not contain "[", "]" or control characters`);
        }
        // A bare String(value) mangles non-primitives (arrays comma-join, objects become
        // "[object Object]") since multipart fields are always strings — JSON.stringify keeps
        // them round-trippable instead of silently losing structure.
        const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
        // JSON.stringify(undefined | function | symbol) is `undefined`, which append() would send
        // as the literal string "undefined".
        if (stringValue === undefined) { continue; }
        formData.append(`client_file[metadata][${key}]`, stringValue);
      }
    }

    const result = await this.sendMultipart<CoolhandClientFileResponse>(
      formData,
      `✅ Successfully uploaded client file: ${payload.name}`
    );

    this.logSeparator();

    return result;
  }

  /**
   * List the client's files of every status, newest first.
   *
   * @param params Optional `status`/`fileType` filters plus `page`/`per`.
   * @returns `{ files, pagination }`. The endpoint renders a bare array and sends
   *   `X-Page`/`X-Per-Page`/`X-Total-Count`/`X-Total-Pages`, which `pagination` is read from.
   * @throws Error on network failure or a non-JSON body. {@link HttpError} with `status` on a
   *   non-2xx response: `422` for an unknown `status`/`fileType`, `403` if the key is not a client
   *   admin's per-user key, `401` for a missing/invalid/public key.
   */
  public async listClientFiles(params: ListClientFilesParams = {}): Promise<ListClientFilesResponse> {
    const url = new URL(this.apiEndpoint);
    this.setQueryParams(url, {
      status: params.status,
      file_type: params.fileType,
      page: params.page,
      per: params.per
    });

    const { body, headers } = await this.getJsonWithHeaders<CoolhandClientFileResponse[]>(url.toString(), 'Client file');
    return { files: body, pagination: this.paginationFromHeaders(headers, body, params) };
  }

  /**
   * Download a file's raw bytes, whatever its status.
   *
   * @param id The file's hashid, i.e. the `id` field from {@link listClientFiles}.
   * @throws Error if `id` is blank or a bare dot-segment (`.`/`..`), on network failure, or when
   *   global `fetch` is unavailable. {@link HttpError} with `status` on a non-2xx response: `404`
   *   for an unknown id or one belonging to another client, `403`/`401` as for {@link listClientFiles}.
   */
  public async downloadClientFile(id: string): Promise<DownloadedClientFile> {
    const url = this.buildResourceUrl(id, 'downloadClientFile: id must be a non-empty string');
    url.pathname += '/content';

    const { bytes, headers } = await this.fetchBytes(
      url.toString(),
      { method: 'GET', headers: { 'X-API-Key': this.apiKey } },
      'Client file request failed'
    );
    return {
      content: bytes,
      contentType: headers.get('content-type'),
      filename: filenameFromContentDisposition(headers.get('content-disposition'))
    };
  }

  /**
   * Change a file's status. Any status may be set from any other; re-setting the current status
   * is a no-op that succeeds.
   *
   * @param id The file's hashid.
   * @param status `draft`, `published` or `archived`.
   * @returns The updated file, or `null` in `dryRun` mode, where no request is sent.
   * @throws Error if `id` is blank or a bare dot-segment, on network failure or a non-JSON body.
   *   {@link HttpError} with `status` on a non-2xx response: `422` for an unknown status, `404`
   *   for an unknown id or one belonging to another client, `403`/`401` as for
   *   {@link listClientFiles}.
   */
  public async updateClientFileStatus(id: string, status: ClientFileStatus): Promise<CoolhandClientFileResponse | null> {
    const url = this.buildResourceUrl(id, 'updateClientFileStatus: id must be a non-empty string');
    if (this.dryRun) {
      this.log(`🚫 DRY RUN: Skipping updateClientFileStatus for client file ${id}`);
      return null;
    }

    const text = await this.fetchOrThrow(
      url.toString(),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-Key': this.apiKey },
        body: JSON.stringify({ client_file: { status } })
      },
      'Client file request failed'
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Client file response was not valid JSON: ${this.excerpt(text)}`);
    }
    if (parsed === null || typeof parsed !== 'object') {
      throw new Error(`Client file response was not a JSON object: ${this.excerpt(text)}`);
    }
    return parsed as CoolhandClientFileResponse;
  }
}
