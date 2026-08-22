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
