import type { CoolhandCallData, DeclaredContext } from '../types';
import { descriptionProblem, keyProblem } from './entity-key.js';

/** Minimal shape of Node's `AsyncLocalStorage` — all this module uses of it. */
interface ContextStore {
  run<R>(store: DeclaredContext, fn: () => R): R;
  getStore(): DeclaredContext | undefined;
}
type ContextStoreCtor = new () => ContextStore;

/** The slice of `node:async_hooks` this module reads. */
interface AsyncHooksModule { AsyncLocalStorage?: unknown }

interface DeclaredShared {
  store: ContextStore | null;
  snapshots: WeakMap<CoolhandCallData, DeclaredContext | null>;
  warnedUnavailable: boolean;
  /** AsyncLocalStorage can never become available (no pending late import) — stop probing. */
  unavailable: boolean;
  lateImportPending: boolean;
}

// Like `global-state.ts`, kept on globalThis under a string key so the CJS and ESM builds (which
// are compiled file-by-file, not bundled) share one store and one snapshot table.
const SHARED_KEY = '__coolhand_node_declared_v1__';
const LATE_CTOR_KEY = '__coolhand_node_declared_als_ctor__';


function shared(): DeclaredShared {
  const g = globalThis as Record<string, unknown>;
  if (!g[SHARED_KEY]) {
    g[SHARED_KEY] = { store: null, snapshots: new WeakMap(), warnedUnavailable: false, unavailable: false, lateImportPending: false } satisfies DeclaredShared;
  }
  return g[SHARED_KEY] as DeclaredShared;
}

/**
 * `node:async_hooks` is deliberately not imported statically: the monitors must load in Edge
 * runtimes, where a top-level Node import can fail before any runtime check runs (see
 * `global-monitor.ts`). Tried in order: a global `AsyncLocalStorage` (Edge / workers), the
 * synchronous built-in loader, CJS `require`, then a constructor filled in by the async `import()`
 * kicked off below for native ESM on older Node.
 */
// Held in a variable so bundlers (webpack, esbuild, Next's Edge build) can't statically resolve it
// and fail the build for consumers that never run this path; the module is only ever reached at
// runtime, behind the guards in resolveCtor.
const ASYNC_HOOKS_ID = 'node:async_hooks';

function resolveCtor(): ContextStoreCtor | null {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.AsyncLocalStorage === 'function') { return g.AsyncLocalStorage as ContextStoreCtor; }
  try {
    const mod = (process as { getBuiltinModule?: (id: string) => AsyncHooksModule | undefined }).getBuiltinModule?.(ASYNC_HOOKS_ID);
    if (typeof mod?.AsyncLocalStorage === 'function') { return mod.AsyncLocalStorage as ContextStoreCtor; }
  } catch { /* fall through */ }
  try {
    const mod = (require as (id: string) => AsyncHooksModule)(ASYNC_HOOKS_ID);
    if (typeof mod?.AsyncLocalStorage === 'function') { return mod.AsyncLocalStorage as ContextStoreCtor; }
  } catch { /* not CJS */ }
  const late = g[LATE_CTOR_KEY];
  return typeof late === 'function' ? (late as ContextStoreCtor) : null;
}

function getStore(): ContextStore | null {
  const s = shared();
  if (s.store) { return s.store; }
  // Probing throws and catches on every miss, and snapshotDeclared runs per intercepted request.
  if (s.unavailable) { return null; }
  const Ctor = resolveCtor();
  if (!Ctor) {
    if (!s.lateImportPending) { s.unavailable = true; }
    return null;
  }
  s.store = new Ctor();
  return s.store;
}

// Native ESM on Node < 20.16 has neither `process.getBuiltinModule` nor `require`; load the module
// asynchronously so it is ready long before a caller can plausibly reach `withContext`.
if (typeof process !== 'undefined' && process.versions?.node && resolveCtor() === null) {
  shared().lateImportPending = true;
  import(/* webpackIgnore: true */ ASYNC_HOOKS_ID)
    .then((m) => { (globalThis as Record<string, unknown>)[LATE_CTOR_KEY] = m.AsyncLocalStorage; })
    .catch(() => { /* no AsyncLocalStorage in this runtime — withContext degrades to a plain call */ })
    .finally(() => { shared().lateImportPending = false; });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonBlankString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function validateKey(field: string, key: string): void {
  const problem = keyProblem(key);
  if (problem) { throw new Error(`withContext: ${field}.key ${problem}`); }
}

function normalizeEntity<T extends 'workload' | 'template'>(
  field: T,
  value: unknown,
  extraFields: readonly string[]
): Record<string, string> {
  if (!isPlainObject(value)) {
    throw new TypeError(`withContext: ${field} must be an object with an "id" or a "key"`);
  }
  const out: Record<string, string> = {};
  const id = nonBlankString(value.id);
  if (id !== undefined) { out.id = id; }
  // A non-string key (e.g. from a computed value) is treated as not given rather than raising.
  if (typeof value.key === 'string') {
    validateKey(field, value.key);
    out.key = value.key;
  }
  if (out.id === undefined && out.key === undefined) {
    throw new Error(`withContext: ${field} needs a non-blank "id" or a "key"`);
  }
  for (const name of extraFields) {
    const v = value[name];
    if (typeof v === 'string') { out[name] = v; }
  }
  const descProblem = out.description === undefined ? null : descriptionProblem(out.description);
  if (descProblem) { throw new Error(`withContext: ${field}.description ${descProblem}`); }
  return out;
}

/**
 * Validates `ctx` (throwing before anything runs) and merges it over `parent`: per top-level field
 * the innermost value wins, `workload`/`template` are replaced wholesale (never key-merged — `id`
 * would win server-side over a merged-in `key`), and a block that sets a `workload` without a
 * `template` does not inherit the outer template.
 */
function mergeContext(parent: DeclaredContext | undefined, ctx: unknown): DeclaredContext {
  if (!isPlainObject(ctx)) {
    throw new TypeError('withContext: first argument must be an object ({ reporter, workload, template })');
  }
  if (ctx.reporter !== undefined && ctx.reporter !== null && typeof ctx.reporter !== 'string') {
    throw new TypeError('withContext: reporter must be a string');
  }
  const reporter = nonBlankString(ctx.reporter);
  const workload = ctx.workload === undefined || ctx.workload === null
    ? undefined
    : normalizeEntity('workload', ctx.workload, ['name', 'description']);
  const template = ctx.template === undefined || ctx.template === null
    ? undefined
    : normalizeEntity('template', ctx.template, ['name']);

  const merged: DeclaredContext = {};
  const mergedReporter = reporter ?? parent?.reporter;
  const mergedWorkload = workload ?? parent?.workload;
  const mergedTemplate = template ?? (workload ? undefined : parent?.template);

  // A template key is find-or-created under a workload; with none, the server 422s and drops the log.
  if (mergedTemplate?.key !== undefined && mergedTemplate.id === undefined && !mergedWorkload) {
    throw new Error('withContext: template.key needs a workload in this or an enclosing withContext (or use template.id)');
  }

  if (mergedReporter !== undefined) { merged.reporter = mergedReporter; }
  if (mergedWorkload) { merged.workload = Object.freeze({ ...mergedWorkload }); }
  if (mergedTemplate) { merged.template = Object.freeze({ ...mergedTemplate }); }
  return Object.freeze(merged);
}

/**
 * Declares which workload/template (and optionally `reporter`) the LLM calls captured while `fn`
 * runs belong to. The declaration is sent as `llm_request_log.declared` and makes the server skip
 * log-to-template matching. Propagates across `await`s via `AsyncLocalStorage`, and nests: see
 * {@link mergeContext}. Returns whatever `fn` returns (a promise stays a promise).
 *
 * @throws Error/TypeError *synchronously, before `fn` runs* for a malformed declaration — never
 *   from inside the host's own LLM call. See `docs/declared-workloads.md` for the rules.
 */
export function withContext<R>(ctx: DeclaredContext, fn: () => R): R {
  if (typeof fn !== 'function') { throw new TypeError('withContext: second argument must be a function'); }
  const store = getStore();
  const merged = mergeContext(store?.getStore(), ctx);
  if (!store) {
    const s = shared();
    if (!s.warnedUnavailable) {
      s.warnedUnavailable = true;
      console.warn('[coolhand-node] withContext: AsyncLocalStorage is unavailable (or not loaded yet) in this runtime; the declaration will not be sent.');
    }
    return fn();
  }
  return store.run(merged, fn);
}

/** The declaration active right now, or `undefined` (an empty `withContext({})` declares nothing). */
export function getCurrentDeclared(): DeclaredContext | undefined {
  try {
    const current = getStore()?.getStore();
    // An empty declaration would still make the server skip template matching for no reason.
    return current && Object.keys(current).length > 0 ? current : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Records the active declaration against `callData`. Call this synchronously where the call is
 * intercepted, before anything is queued or awaited: the log is sent from a later async context
 * (response end, a stream tee settling) where the store may no longer hold this call's declaration.
 * Never throws — capture must not break the host's request. A `null` entry (nothing declared) is
 * still recorded so {@link consumeDeclared} never falls back to a later, unrelated store.
 */
export function snapshotDeclared(callData: CoolhandCallData): void {
  try {
    shared().snapshots.set(callData, getCurrentDeclared() ?? null);
  } catch { /* ignore */ }
}

/**
 * The declaration to send for `callData`: the interception-time snapshot if one was taken,
 * otherwise (manual `logRequest`, which runs synchronously in the caller's context) the active one.
 */
export function consumeDeclared(callData: CoolhandCallData): DeclaredContext | undefined {
  const snapshots = shared().snapshots;
  if (snapshots.has(callData)) { return snapshots.get(callData) ?? undefined; }
  return getCurrentDeclared();
}
