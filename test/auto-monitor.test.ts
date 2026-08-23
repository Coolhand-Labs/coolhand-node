describe('auto-monitor', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  function loadIsolated(isActive: boolean, apiKey?: string): { initMock: jest.Mock; isActiveMock: jest.Mock } {
    const initMock = jest.fn(); // initGlobalMonitoringCore is synchronous
    const isActiveMock = jest.fn().mockReturnValue(isActive);

    if (apiKey !== undefined) {
      process.env.COOLHAND_API_KEY = apiKey;
    } else {
      delete process.env.COOLHAND_API_KEY;
    }

    jest.isolateModules(() => {
      jest.doMock('../src/global-monitor.js', () => ({
        isGlobalMonitoringActive: isActiveMock,
        initializeGlobalMonitoring: jest.fn().mockResolvedValue(undefined),
        initGlobalMonitoringCore: initMock,
        loadAndPatchNodeModulesIfNeeded: jest.fn().mockResolvedValue(undefined),
        getGlobalStats: jest.fn(),
      }));
      require('../src/auto-monitor');
    });

    return { initMock, isActiveMock };
  }

  it('skips init silently when singleton is already active (second module context)', async () => {
    process.env.COOLHAND_SILENT = 'false';
    const { initMock } = loadIsolated(true, 'test-key');
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(initMock).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalledWith('🔧 Auto-initializing global monitoring...');
  });

  it('initializes when singleton is not yet active (first module context)', async () => {
    process.env.COOLHAND_SILENT = 'false';
    const { initMock } = loadIsolated(false, 'test-key');
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(initMock).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'test-key' }));
  });

  it('does not init when COOLHAND_API_KEY is absent', async () => {
    const { initMock } = loadIsolated(false, undefined);
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(initMock).not.toHaveBeenCalled();
  });

  it('parses COOLHAND_EXCLUDE_API_PATTERNS into a trimmed array', async () => {
    process.env.COOLHAND_EXCLUDE_API_PATTERNS = '/foo/ , /bar/,/baz/';
    const { initMock } = loadIsolated(false, 'test-key');
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(initMock).toHaveBeenCalledWith(expect.objectContaining({
      excludeApiPatterns: ['/foo/', '/bar/', '/baz/']
    }));
  });

  it('leaves excludeApiPatterns undefined when the env var is not set', async () => {
    delete process.env.COOLHAND_EXCLUDE_API_PATTERNS;
    const { initMock } = loadIsolated(false, 'test-key');
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(initMock).toHaveBeenCalledWith(expect.objectContaining({
      excludeApiPatterns: undefined
    }));
  });

  it('falls back to undefined (not []) when the env var parses to zero usable entries', async () => {
    // A degenerate value like ",", " ", or " , , " is a non-empty string, so naively it would
    // take the parse branch and yield [] — which downstream (global-monitor.ts's
    // `config.excludeApiPatterns ?? DEFAULT_EXCLUDE_API_PATTERNS`) is NOT equivalent to "unset":
    // an explicit [] opts out of the built-in /batchPredictionJobs/ exclusion entirely. A
    // malformed env var must not silently trigger that same opt-out.
    process.env.COOLHAND_EXCLUDE_API_PATTERNS = ' , , ';
    const { initMock } = loadIsolated(false, 'test-key');
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(initMock).toHaveBeenCalledWith(expect.objectContaining({
      excludeApiPatterns: undefined
    }));
  });
});
