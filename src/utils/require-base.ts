/**
 * Base path for `createRequire`, which accepts a file URL string or an absolute path. Only Node
 * built-ins (`http`, `https`, `stream`) are ever loaded through it, and those resolve the same from
 * any base — so the module's own location (`import.meta.url`) is not needed. It also can't be had
 * cheaply: `eval('import.meta.url')` throws in every format (direct eval is parsed as a Script),
 * and a literal `import.meta` is a compile error in the CJS build and under ts-jest.
 *
 * An absolute path, not a hand-built 'file://' + process.cwd(): that produces
 * 'file://C:\Users\...' on Windows (drive letter in the URL host slot), and building a valid URL
 * would need url.pathToFileURL — a Node import the monitors must not take at load time.
 */
export const createRequireBase = (): string => process.cwd() + '/';
