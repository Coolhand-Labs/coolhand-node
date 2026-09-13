/**
 * End-to-end proof of `searchReferencedFiles`/`listReferencedFileSessions` against a REAL Coolhand
 * server. Nothing here is mocked — every assertion is about a response that actually came off the
 * wire.
 *
 * Run it with `npm run test:live`; it is not part of `npm test`, because it needs a reachable
 * server (see `templates.live.ts` for why).
 *
 *   COOLHAND_LIVE_BASE_URL=http://127.0.0.1:3111 \
 *   COOLHAND_LIVE_API_KEY=<your private key> \
 *   npm run test:live
 *
 * Unlike `templates.live.ts`, the API key is optional here rather than required up front. The
 * unauthenticated assertions below need only `COOLHAND_LIVE_BASE_URL` — proving a real 401 shape
 * doesn't need a credential — and run unconditionally. The authenticated assertions are skipped
 * outright (`describe.skip`) when `COOLHAND_LIVE_API_KEY` is absent, per
 * https://github.com/Coolhand-Labs/coolhand-node/issues/221's "Credentials for live testing"
 * section: this endpoint is private-key-only, and no key was provisioned for this run. Set the
 * env var and re-run for full coverage — nothing else here needs to change.
 *
 * Every request is read-only. Nothing in this file creates, updates or deletes a record, so it is
 * safe to point at a shared development database.
 */
import { LlmReferenceService } from '../../src/services/LlmReferenceService';
import { LlmReferencedFile } from '../../src/types';

const baseUrl = process.env.COOLHAND_LIVE_BASE_URL;

if (!baseUrl) {
  throw new Error(
    'Live tests need COOLHAND_LIVE_BASE_URL in the environment. Set it and re-run `npm run test:live`.'
  );
}

// Re-bound after the guard so the rest of the file sees plain `string`, without a cast.
const LIVE_BASE_URL: string = baseUrl;
const LIVE_API_KEY = process.env.COOLHAND_LIVE_API_KEY;

function newService(key: string): LlmReferenceService {
  return new LlmReferenceService({ apiKey: key, silent: true, baseUrl: LIVE_BASE_URL });
}

function expectFileShape(file: LlmReferencedFile): void {
  expect(typeof file.file_path).toBe('string');
  expect(file.file_path.length).toBeGreaterThan(0);
  expect(Number.isInteger(file.reference_count)).toBe(true);
  expect(file.reference_count).toBeGreaterThan(0);
  expect(typeof file.last_referenced_at).toBe('string');
  // The aggregated shape has no id field at all — not merely omitted from this view, but absent
  // from the endpoint's response shape entirely.
  expect(file).not.toHaveProperty('id');
}

describe('LlmReferenceService against a live server', () => {
  describe('authentication (no credential required)', () => {
    it('rejects searchReferencedFiles with no API key', async () => {
      await expect(newService('').searchReferencedFiles()).rejects.toMatchObject({ status: 401 });
    });

    it('rejects searchReferencedFiles with an invalid API key', async () => {
      await expect(
        newService('ch_priv_definitely_not_a_real_key').searchReferencedFiles()
      ).rejects.toMatchObject({ status: 401 });
    });

    it('rejects listReferencedFileSessions with no API key', async () => {
      await expect(
        newService('').listReferencedFileSessions({ filePath: 'config/routes.rb' })
      ).rejects.toMatchObject({ status: 401 });
    });
  });

  (LIVE_API_KEY ? describe : describe.skip)('with a private API key', () => {
    const authedKey = LIVE_API_KEY as string;

    function authedService(): LlmReferenceService {
      return newService(authedKey);
    }

    describe('searchReferencedFiles', () => {
      it('returns referenced files ordered by reference_count descending, with real pagination headers', async () => {
        const { files, pagination } = await authedService().searchReferencedFiles();

        for (const file of files) {
          expectFileShape(file);
        }
        for (let i = 1; i < files.length; i++) {
          expect(files[i - 1].reference_count).toBeGreaterThanOrEqual(files[i].reference_count);
        }
        expect(pagination.current_page).toBe(1);
        expect(pagination.per_page).toBe(25);
        if (pagination.total_pages <= 1) {
          expect(pagination.total_count).toBe(files.length);
        } else {
          expect(pagination.total_count).toBeGreaterThan(files.length);
        }
      });

      it('filters by filePathContains', async () => {
        const { files: all } = await authedService().searchReferencedFiles({ per: 100 });
        if (all.length === 0) {
          throw new Error('Live fixture broken: no referenced files to filter against.');
        }
        const target = all[0];
        const needle = target.file_path.slice(0, Math.max(1, Math.floor(target.file_path.length / 2)));

        const { files: filtered } = await authedService().searchReferencedFiles({ filePathContains: needle });

        expect(filtered.length).toBeGreaterThan(0);
        for (const file of filtered) {
          expect(file.file_path.toLowerCase()).toContain(needle.toLowerCase());
        }
      });

      it('honours per as a real page size', async () => {
        const { files: all } = await authedService().searchReferencedFiles({ per: 100 });
        if (all.length < 2) {
          return; // Not enough live data to prove pagination narrows the page.
        }

        const { files, pagination } = await authedService().searchReferencedFiles({ per: 1 });

        expect(files).toHaveLength(1);
        expect(pagination.per_page).toBe(1);
      });
    });

    describe('listReferencedFileSessions', () => {
      it('returns raw per-session rows for a file found via searchReferencedFiles', async () => {
        const { files } = await authedService().searchReferencedFiles({ per: 1 });
        if (files.length === 0) {
          throw new Error('Live fixture broken: no referenced files to drill into.');
        }

        const { sessions, pagination } = await authedService().listReferencedFileSessions({
          filePath: files[0].file_path
        });

        expect(sessions.length).toBeGreaterThan(0);
        for (const session of sessions) {
          expect(typeof session.llm_request_log_id).toBe('string');
          expect(session.llm_request_log_id.length).toBeGreaterThan(0);
          expect(typeof session.created_at).toBe('string');
        }
        expect(pagination.total_count).toBeGreaterThanOrEqual(sessions.length);
      });

      it('returns an empty page, not a 404, for a file_path that matches nothing', async () => {
        const { sessions } = await authedService().listReferencedFileSessions({
          filePath: 'no/such/file-ever-referenced.rb'
        });

        expect(sessions).toEqual([]);
      });

      it('rejects a blank file_path with 422 rather than treating it as unfiltered', async () => {
        await expect(authedService().listReferencedFileSessions({ filePath: '' })).rejects.toMatchObject({
          status: 422
        });
      });
    });
  });
});
