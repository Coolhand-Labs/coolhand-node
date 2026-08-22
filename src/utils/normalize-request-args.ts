import { CoolhandRequestOptions } from '../types.js';

function urlToOptions(url: string | URL): CoolhandRequestOptions {
  const parsed = typeof url === 'string' ? new URL(url) : url;
  const hostname = parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
    ? parsed.hostname.slice(1, -1)
    : parsed.hostname;

  const options: CoolhandRequestOptions = {
    hostname,
    path: `${parsed.pathname}${parsed.search}`,
  };
  if (parsed.port) {
    options.port = Number(parsed.port);
  }
  if (parsed.username || parsed.password) {
    options.auth = `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`;
  }
  return options;
}

export interface NormalizedRequestArgs<TCallback> {
  options: CoolhandRequestOptions | string | URL;
  callback?: TCallback;
}

/**
 * Normalizes http(s).request/get's two call shapes — (options[, callback])
 * and (url[, options][, callback]) — into a single {options, callback} pair,
 * mirroring Node's own _normalizeArgs. Deliberately omits `href` from the
 * merged options so buildURL's hostname/port/path reconstruction reflects
 * any override in the options argument.
 */
// TCallback is intentionally `any`-bounded: callers pass differently-typed Node response
// callbacks (`(res: any) => void` from global-monitor.ts vs `(res: http.IncomingMessage) => void`
// from RequestMonitoringService.ts), and this helper only forwards the callback, never inspects it.
export function normalizeRequestArgs<TCallback extends (...args: any[]) => any>(
  urlOrOptions: CoolhandRequestOptions | string | URL,
  optionsOrCallback?: CoolhandRequestOptions | TCallback,
  callback?: TCallback
): NormalizedRequestArgs<TCallback> {
  if (typeof optionsOrCallback === 'function') {
    return { options: urlOrOptions, callback: optionsOrCallback };
  }

  if (optionsOrCallback && typeof optionsOrCallback === 'object' &&
      (typeof urlOrOptions === 'string' || urlOrOptions instanceof URL)) {
    return {
      options: { ...urlToOptions(urlOrOptions), ...optionsOrCallback },
      callback
    };
  }

  return { options: urlOrOptions, callback };
}
