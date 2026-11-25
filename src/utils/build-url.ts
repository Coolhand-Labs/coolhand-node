import type { CoolhandRequestOptions } from '../types.js';
import { formatHostForUrl } from './url-host.js';

/**
 * Reconstructs the target URL of an intercepted http(s).request call.
 *
 * `options.path` is not guaranteed to start with `/` — Node's http.request tolerates a slash-less
 * path. Without normalization the host and path would run together (`...amazonaws.comv1/messages`),
 * so a `/` is prepended when the path does not already start with one (an existing leading `/`,
 * including `//`, is left untouched).
 * A path starting with `?` becomes `/?...`, which is the correct URL.
 */
export function buildRequestURL(options: CoolhandRequestOptions | string | URL, protocol: string): string {
  if (typeof options === 'string') {
    return options;
  }

  if (options instanceof URL) {
    return options.toString();
  }

  if (options.href) { return options.href; }

  const hostname = formatHostForUrl(options.hostname || options.host || 'unknown');
  // String(): Node tolerates non-string paths (coerced via toString); a bare .startsWith would throw
  // inside the patched request and break the host app's call.
  const rawPath = String(options.path || '/');
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const port = options.port ? `:${options.port}` : '';

  return `${protocol}://${hostname}${port}${path}`;
}
