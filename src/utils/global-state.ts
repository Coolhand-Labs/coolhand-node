import type { PatternMatchingService } from '../services/PatternMatchingService.js';
import type { LoggingService } from '../services/LoggingService.js';
import type { SelfEndpoint } from './self-endpoint.js';

// State is stored on globalThis so both the CJS and ESM builds of this module
// share the same values in a mixed-format Node.js process. A string key (not a
// Symbol) is required because Symbols are per-realm and would be independent
// across module formats.
const COOLHAND_STATE_KEY = '__coolhand_node_v1__';

export interface CoolhandGlobalState {
  globalPatternService: PatternMatchingService | null;
  globalLoggingService: LoggingService | null;
  isGloballyPatched: boolean;
  /**
   * http/https and fetch are patched by either global-monitor.ts (auto-monitor) or
   * RequestMonitoringService (`new Coolhand()`), and possibly by two copies of either (dual
   * CJS/ESM). Whoever patches first sets the flag so the second never wraps them again, which
   * would log every request twice and double each response tee's memory.
   */
  httpPatched: boolean;
  fetchPatched: boolean;
  callCounter: number;
  interceptedCalls: number;
  silent: boolean;
  globalActiveRequests: Map<string, { timestamp: number; requestIds: Set<string> }>;
  excludeApiPatterns: string[];
  selfEndpoint: SelfEndpoint | null;
}

export function getState(): CoolhandGlobalState {
  const g = globalThis as Record<string, unknown>;
  if (!g[COOLHAND_STATE_KEY]) {
    g[COOLHAND_STATE_KEY] = {
      globalPatternService: null,
      globalLoggingService: null,
      isGloballyPatched: false,
      httpPatched: false,
      fetchPatched: false,
      callCounter: 0,
      interceptedCalls: 0,
      silent: true,
      globalActiveRequests: new Map(),
      excludeApiPatterns: [],
      selfEndpoint: null,
    } satisfies CoolhandGlobalState;
  }
  return g[COOLHAND_STATE_KEY] as CoolhandGlobalState;
}

/** Reset all singleton state — for use in tests only. */
export function _resetGlobalState(): void {
  delete (globalThis as Record<string, unknown>)[COOLHAND_STATE_KEY];
}
