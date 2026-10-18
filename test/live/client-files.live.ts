/**
 * End-to-end proof of `listClientFiles`/`downloadClientFile`/`updateClientFileStatus` against a REAL
 * Coolhand server. Nothing here is mocked.
 *
 * Run it with `npm run test:live`. In addition to the variables `env.ts` requires —
 * `COOLHAND_LIVE_API_KEY` must be a client admin's **per-user** private key — the refusal tests
 * need one credential of each refused kind:
 *
 *   COOLHAND_LIVE_MEMBER_USER_KEY  per-user key of a non-admin member (403)
 *   COOLHAND_LIVE_CLIENT_KEY       the client-level private key (403)
 *   COOLHAND_LIVE_PUBLIC_KEY       the public key (401)
 *
 * The status tests mutate the seeded files and restore every status they change in `afterAll`.
 */
import { ClientFileService } from '../../src/services/ClientFileService';
import { HttpError } from '../../src/services/BaseService';
import { CoolhandClientFileResponse } from '../../src/types';
import { LIVE_API_KEY, LIVE_BASE_URL } from './env';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Live client file tests need ${name} in the environment (see the header of this file).`);
  }
  return value;
}

function newService(key: string = LIVE_API_KEY): ClientFileService {
  return new ClientFileService({ apiKey: key, silent: true, baseUrl: LIVE_BASE_URL });
}

async function expectHttpStatus(promise: Promise<unknown>, status: number): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(HttpError);
  expect((error as HttpError).status).toBe(status);
}

function expectFileShape(file: CoolhandClientFileResponse): void {
  expect(typeof file.id).toBe('string');
  expect(file.id.length).toBeGreaterThan(0);
  expect(typeof file.name).toBe('string');
  expect(['slide_deck', 'report', 'document']).toContain(file.file_type);
  expect(['draft', 'published', 'archived']).toContain(file.status);
  expect(file.description === null || typeof file.description === 'string').toBe(true);
  expect(typeof file.metadata).toBe('object');
  expect(Number.isNaN(Date.parse(file.created_at))).toBe(false);
}

describe('ClientFileService admin operations against a live server', () => {
  const originalStatuses = new Map<string, CoolhandClientFileResponse['status']>();

  afterAll(async () => {
    for (const [id, status] of originalStatuses) {
      await newService().updateClientFileStatus(id, status as 'draft' | 'published' | 'archived');
    }
  });

  describe('listClientFiles', () => {
    it('lists files of every status with pagination read from the headers', async () => {
      const { files, pagination } = await newService().listClientFiles();

      expect(files.length).toBeGreaterThan(0);
      files.forEach(expectFileShape);
      expect([...new Set(files.map((f) => f.status))].sort()).toEqual(['archived', 'draft', 'published']);
      expect(pagination.current_page).toBe(1);
      expect(pagination.per_page).toBe(25);
      expect(pagination.total_count).toBe(files.length);
      expect(pagination.total_pages).toBe(1);
      expect(pagination.has_next_page).toBe(false);
      files.forEach((f) => originalStatuses.set(f.id, f.status as CoolhandClientFileResponse['status']));
    });

    it('is newest first', async () => {
      const { files } = await newService().listClientFiles();
      const times = files.map((f) => Date.parse(f.created_at));
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it.each(['draft', 'published', 'archived'] as const)('filters by status=%s', async (status) => {
      const { files, pagination } = await newService().listClientFiles({ status });

      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        expect(file.status).toBe(status);
      }
      expect(pagination.total_count).toBe(files.length);
    });

    it('filters by fileType', async () => {
      const { files } = await newService().listClientFiles({ fileType: 'report' });

      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        expect(file.file_type).toBe('report');
      }
    });

    it('pages with per=1&page=2 and reports the totals off the headers', async () => {
      const all = await newService().listClientFiles();
      const { files, pagination } = await newService().listClientFiles({ per: 1, page: 2 });

      expect(files).toHaveLength(1);
      expect(files[0].id).toBe(all.files[1].id);
      expect(pagination).toEqual({
        current_page: 2,
        per_page: 1,
        total_count: all.pagination.total_count,
        total_pages: all.pagination.total_count,
        has_next_page: all.pagination.total_count > 2,
        has_prev_page: true
      });
    });

    it('rejects an unknown status with 422', async () => {
      await expectHttpStatus(newService().listClientFiles({ status: 'bogus' as never }), 422);
    });

    it('rejects an unknown fileType with 422', async () => {
      await expectHttpStatus(newService().listClientFiles({ fileType: 'bogus' as never }), 422);
    });
  });

  describe('downloadClientFile', () => {
    it('round-trips the seeded deck.txt bytes with content type and filename', async () => {
      const { files } = await newService().listClientFiles();
      const results = await Promise.all(files.map((f) => newService().downloadClientFile(f.id)));
      const deck = results.find((r) => r.filename === 'deck.txt');

      expect(deck).toBeDefined();
      expect(deck?.content.toString('utf8')).toBe('slides');
      expect(deck?.contentType).toContain('text/plain');
    });

    it('404s for an unknown id', async () => {
      await expectHttpStatus(newService().downloadClientFile('doesnotexist'), 404);
    });
  });

  describe('updateClientFileStatus', () => {
    it('moves a file through every status and back, returning the updated file each time', async () => {
      const { files } = await newService().listClientFiles();
      const target = files[0];
      originalStatuses.set(target.id, target.status as CoolhandClientFileResponse['status']);

      for (const status of ['published', 'archived', 'draft'] as const) {
        const updated = await newService().updateClientFileStatus(target.id, status);
        expect(updated).not.toBeNull();
        expectFileShape(updated as CoolhandClientFileResponse);
        expect(updated?.id).toBe(target.id);
        expect(updated?.status).toBe(status);
      }

      const noop = await newService().updateClientFileStatus(target.id, 'draft');
      expect(noop?.status).toBe('draft');

      const after = await newService().listClientFiles({ status: 'draft' });
      expect(after.files.map((f) => f.id)).toContain(target.id);
    });

    it('rejects an unknown status with 422', async () => {
      const { files } = await newService().listClientFiles();
      await expectHttpStatus(newService().updateClientFileStatus(files[0].id, 'bogus' as never), 422);
    });

    it('404s for an unknown id', async () => {
      await expectHttpStatus(newService().updateClientFileStatus('doesnotexist', 'draft'), 404);
    });
  });

  describe('refused credentials', () => {
    const refused: Array<[string, string, number]> = [
      ['a non-admin member per-user key', 'COOLHAND_LIVE_MEMBER_USER_KEY', 403],
      ['the client-level private key', 'COOLHAND_LIVE_CLIENT_KEY', 403],
      ['the public key', 'COOLHAND_LIVE_PUBLIC_KEY', 401]
    ];

    it.each(refused)('%s is refused on all three operations', async (_label, envName, status) => {
      const service = newService(requireEnv(envName));
      const { files } = await newService().listClientFiles();
      const id = files[0].id;

      await expectHttpStatus(service.listClientFiles(), status);
      await expectHttpStatus(service.downloadClientFile(id), status);
      await expectHttpStatus(service.updateClientFileStatus(id, files[0].status as 'draft'), status);
    });

    it('a missing key is a 401', async () => {
      await expectHttpStatus(newService('').listClientFiles(), 401);
    });
  });
});
