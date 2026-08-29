describe('auto-monitor', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  function loadIsolated(
    isActive: boolean,
    apiKey?: string,
    initImpl?: jest.Mock
  ): { initMock: jest.Mock; isActiveMock: jest.Mock; loadAndPatchMock: jest.Mock } {
    // isActiveMock tracks real init state rather than returning a fixed value: auto-monitor
    // now re-checks isGlobalMonitoringActive() after the try/catch (instead of a separate
    // failure flag) to decide whether to run the async tail, so the mock must flip to true
    // on a successful (non-throwing) init to exercise that path realistically. A throwing
    // initImpl never flips it, matching real initGlobalMonitoringCore leaving state untouched.
    let currentlyActive = isActive;
    const initMock = initImpl ?? jest.fn(() => { currentlyActive = true; });
    const isActiveMock = jest.fn(() => currentlyActive);
    const loadAndPatchMock = jest.fn().mockResolvedValue(undefined);

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
        loadAndPatchNodeModulesIfNeeded: loadAndPatchMock,
        getGlobalStats: jest.fn(),
      }));
      require('../src/auto-monitor');
    });

    return { initMock, isActiveMock, loadAndPatchMock };
  }

  it('skips init silently when singleton is already active (second module context)', async () => {
    process.env.COOLHAND_SILENT = 'false';
    const { initMock, loadAndPatchMock } = loadIsolated(true, 'test-key');
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(initMock).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalledWith('🔧 Auto-initializing global monitoring...');
    // The async tail must still run to complete ESM http/https patching for this
    // module instance, even though init itself was skipped (already active elsewhere).
    expect(loadAndPatchMock).toHaveBeenCalled();
  });

  it('initializes when singleton is not yet active (first module context)', async () => {
    process.env.COOLHAND_SILENT = 'false';
    const { initMock, loadAndPatchMock } = loadIsolated(false, 'test-key');
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(initMock).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'test-key' }));
    // Successful init must still run the async tail (ESM http/https completion).
    expect(loadAndPatchMock).toHaveBeenCalled();
  });

  it('does not init when COOLHAND_API_KEY is absent', async () => {
    const { initMock } = loadIsolated(false, undefined);
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(initMock).not.toHaveBeenCalled();
  });

  // Regression test for issue #169: when initGlobalMonitoringCore throws (e.g. an
  // invalid COOLHAND_BASE_URL), auto-monitor must not proceed to
  // loadAndPatchNodeModulesIfNeeded() — that would patch http/https with no logging
  // service attached, and leave isGloballyPatched false so a later successful retry
  // double-patches.
  it('does not call loadAndPatchNodeModulesIfNeeded when initGlobalMonitoringCore throws', async () => {
    const throwingInit = jest.fn(() => {
      throw new Error('Invalid baseUrl: "not-a-url" is not a valid URL');
    });
    const { loadAndPatchMock } = loadIsolated(false, 'test-key', throwingInit);
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(throwingInit).toHaveBeenCalled();
    expect(loadAndPatchMock).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      '❌ Failed to initialize global monitoring:',
      expect.any(String)
    );
  });
});
