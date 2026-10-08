import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_API_PATTERNS } from '../src/default-api-patterns';
import type { PatternMatchingService as PatternMatchingServiceType } from '../src/services/PatternMatchingService';

// Covers the async `loadPatterns()` path — used when a custom `patternsFile` cannot be read
// synchronously (native ESM on Node < 20.16 / < 22.3). Kept apart from pattern-matching-service.test.ts,
// which auto-mocks fs/path for the whole file; here fs is real except for one simulated failure.

describe('PatternMatchingService.loadPatterns', () => {
  let dir: string;
  const originalGetBuiltinModule = (process as any).getBuiltinModule;

  const customPatterns = { patterns: [{ name: 'Custom', domains: ['custom.example.com'] }] };

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coolhand-load-patterns-'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    (process as any).getBuiltinModule = originalGetBuiltinModule;
    jest.restoreAllMocks();
    jest.resetModules();
    jest.dontMock('fs');
  });

  function writePatterns(name: string, contents: unknown): string {
    const file = path.join(dir, name);
    fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
    return file;
  }

  function loadService(): typeof PatternMatchingServiceType {
    return require('../src/services/PatternMatchingService').PatternMatchingService;
  }

  // Simulates native ESM on Node < 20.16 / < 22.3: the synchronous fs lookup (require, then
  // process.getBuiltinModule) fails, while the dynamic import used by loadPatterns() succeeds.
  function serviceWithoutSyncFs(file: string, silent = true): PatternMatchingServiceType {
    let requests = 0;
    jest.resetModules();
    jest.doMock('fs', () => {
      requests += 1;
      if (requests === 1) { throw new Error('no synchronous fs'); }
      return jest.requireActual('fs');
    });
    (process as any).getBuiltinModule = undefined;
    const Service = loadService();
    return new Service({ customPatternsFile: file, silent });
  }

  it('starts on the built-in patterns and warns loudly, even in silent mode', () => {
    const svc = serviceWithoutSyncFs(writePatterns('pending.json', customPatterns));

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('cannot be loaded synchronously'));
    expect(svc.getPatternsCountSync()).toBe(DEFAULT_API_PATTERNS.length);
    expect(svc.matchesAPIPatternSync('https://custom.example.com/x')).toBeNull();
  });

  it('loads the custom file once loadPatterns() completes', async () => {
    const svc = serviceWithoutSyncFs(writePatterns('loaded.json', customPatterns));

    await svc.loadPatterns();

    expect(svc.getPatternsCountSync()).toBe(1);
    expect(svc.matchesAPIPatternSync('https://custom.example.com/x')?.pattern.name).toBe('Custom');
    expect(svc.matchesAPIPatternSync('https://api.openai.com/v1/chat/completions')).toBeNull();
  });

  it('is idempotent and safe to call concurrently', async () => {
    const svc = serviceWithoutSyncFs(writePatterns('idempotent.json', customPatterns));

    await Promise.all([svc.loadPatterns(), svc.loadPatterns()]);
    await svc.loadPatterns();

    expect(svc.getPatternsCountSync()).toBe(1);
  });

  it('keeps the built-in patterns and never rejects when the file is missing', async () => {
    const svc = serviceWithoutSyncFs(path.join(dir, 'does-not-exist.json'), false);

    await expect(svc.loadPatterns()).resolves.toBeUndefined();

    expect(svc.getPatternsCountSync()).toBe(DEFAULT_API_PATTERNS.length);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('API patterns file not found'));
  });

  it('keeps the built-in patterns and never rejects when the file is invalid', async () => {
    const svc = serviceWithoutSyncFs(writePatterns('invalid.json', '{ nope'), false);

    await expect(svc.loadPatterns()).resolves.toBeUndefined();

    expect(svc.getPatternsCountSync()).toBe(DEFAULT_API_PATTERNS.length);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Error loading API patterns'), expect.any(String));
  });

  it('is a no-op when nothing is pending (default patterns, or the constructor already loaded the file)', async () => {
    const Service = loadService();
    const file = writePatterns('sync.json', customPatterns);
    const fromFile = new Service({ customPatternsFile: file, silent: true });
    const defaults = new Service({ silent: true });
    // A re-read would pick this up
    writePatterns('sync.json', { patterns: [] });

    await fromFile.loadPatterns();
    await defaults.loadPatterns();

    expect(fromFile.getPatternsCountSync()).toBe(1);
    expect(defaults.getPatternsCountSync()).toBe(DEFAULT_API_PATTERNS.length);
  });
});
