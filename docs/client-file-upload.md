# Client File Upload API

`uploadClientFile()` uploads a file (slide deck, report, or document) to Coolhand.

**Auth:** requires your **private** API key, passed as `apiKey` in the `Coolhand` constructor. The
public key used for `logRequest`/`createFeedback` will 401 on this endpoint — construct a separate
`Coolhand` instance with the private key if your process also logs with the public key.

## Usage

```typescript
import { Coolhand } from 'coolhand-node';
import { readFile } from 'fs/promises';

const coolhand = new Coolhand({
  apiKey: 'your-private-api-key'
});

const file = await readFile('./q3-review.pdf');

const result = await coolhand.uploadClientFile({
  name: 'Q3 Review',
  file_type: 'slide_deck', // optional: 'slide_deck' | 'report' | 'document' (default: 'document')
  description: 'Quarterly business review deck', // optional
  file,
  filename: 'q3-review.pdf',
  metadata: { project_path: '/Users/me/my-project' } // optional: free-form
});

// result is CoolhandClientFileResponse | null
// null is returned on upload failure or in dry-run mode
console.log(result?.id); // Coolhand client file ID assigned by the API
```

## Parameters

**`payload: CoolhandClientFilePayload`**

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Required. Display name for the file. |
| `file_type` | `'slide_deck' \| 'report' \| 'document'` | Optional. Defaults to `'document'`. |
| `description` | `string` | Optional. |
| `file` | `Buffer \| Blob` | Required. File contents, up to 20MB. |
| `filename` | `string` | Required. Filename sent with the upload. |
| `metadata` | `Record<string, unknown>` | Optional. Free-form; the one convention the backend cares about is `project_path`. |

`status` is not settable — uploads always land as `draft`.

## Return value

`Promise<CoolhandClientFileResponse | null>` — resolves to the API response (`id`, `name`, `file_type`, `status`, `description`, `metadata`, `created_at`) on success, or `null` when:
- the upload failed (network error or non-2xx response)
- `dryRun` mode is enabled

Requires Node.js 18+ — `uploadClientFile` uses global `fetch`/`FormData`/`Blob`, with no fallback for older Node versions.

# Listing, downloading and publishing client files

`listClientFiles()`, `downloadClientFile()` and `updateClientFileStatus()` let a client admin review
uploaded files and move them between `draft`, `published` and `archived`.

**Auth:** these three require a **per-user API key** (`ch_priv_...`) belonging to a **client admin**
of the client, passed as `apiKey`. The client-level private key, the public key and OAuth tokens
are refused (`403` or `401`), as are keys of non-admin members (`403`). `uploadClientFile` is
unaffected and keeps accepting the client-level private key.

**Errors:** unlike `uploadClientFile`, these throw instead of resolving to `null`. A non-2xx
response throws an `HttpError` whose `status` is the HTTP status code (`401`, `403`, `404`, `422`).

```typescript
const coolhand = new Coolhand({ apiKey: process.env.COOLHAND_USER_API_KEY! }); // client admin's per-user key

// List (newest first, every status). `status` and `fileType` are optional filters.
const { files, pagination } = await coolhand.listClientFiles({ status: 'draft', page: 1, per: 25 });

// Download the raw bytes
const { content, contentType, filename } = await coolhand.downloadClientFile(files[0].id);
await writeFile(filename ?? 'download', content); // content is a Buffer

// Publish (or 'archived' / 'draft'; any status can be set from any other)
const published = await coolhand.updateClientFileStatus(files[0].id, 'published');
```

| Method | Returns |
|---|---|
| `listClientFiles(params?)` | `{ files: CoolhandClientFileResponse[], pagination }` — `pagination` is read from the `X-Page`/`X-Per-Page`/`X-Total-Count`/`X-Total-Pages` response headers |
| `downloadClientFile(id)` | `{ content: Buffer, contentType: string \| null, filename: string \| null }` |
| `updateClientFileStatus(id, status)` | the updated `CoolhandClientFileResponse`, or `null` in `dryRun` mode |

`listClientFiles` params: `status` (`'draft' | 'published' | 'archived'`), `fileType`
(`'slide_deck' | 'report' | 'document'`), `page` (1-based), `per` (default 25, max 100). An unknown
`status` or `fileType` is a `422`. `id` is the file's hashid. `downloadClientFile` and
`updateClientFileStatus` return a `404` for an unknown id or one belonging to another client.
