export interface EmitLikeRequest {
  // Mirrors Node's own EventEmitter#emit signature (also `any[]`) rather than `unknown[]` — every
  // arg past the first is only ever re-forwarded via `originalEmit(event, ...args)` below, never
  // inspected, so there's no type information to preserve by narrowing it.
  emit: (event: string, ...args: any[]) => boolean;
  listenerCount: (event: string) => number;
}

/**
 * A `'response'` listener can't change what argument *other* listeners receive — EventEmitter
 * hands every listener for an event the same args array. So instead of racing to be "the"
 * listener, this wraps `req.emit` itself: the first `'response'` emission is routed through
 * `internalCapture` (which always sees the real, raw response — for the interceptor's own body
 * capture, which must never be starved by tee/backpressure semantics) before being re-emitted
 * with whatever `internalCapture` returns (a tee, or the raw response as a fallback) to *every*
 * listener — whether registered via a callback passed to `.request()`/`.get()` (itself just sugar
 * for `req.once('response', callback)`) or via `req.on('response', ...)` after the call returns.
 * Both calling conventions are unified under this single substitution path.
 */
export function patchResponseEmit<Req extends EmitLikeRequest, Res>(
  req: Req,
  internalCapture: (res: Res) => Res,
  onPatchFailure?: () => void
): void {
  try {
    const originalEmit = req.emit.bind(req);
    let handled = false;
    req.emit = function (event: string, ...args: any[]): boolean {
      if (event === 'response' && !handled) {
        handled = true;
        // internalCapture runs from inside Node's own http internals (whatever calls
        // req.emit('response', res)), not from a call site this module controls — if it throws,
        // let the raw response through rather than letting the exception escape into Node's
        // internals uncaught. Every other patch point in this codebase degrades the same way.
        let delivered: Res = args[0];
        try {
          delivered = internalCapture(args[0]);
        } catch {
          onPatchFailure?.();
        }
        // internalCapture always attaches its own listeners directly on the response object (see
        // callers), so the response must always be treated as "handled" from Node's http client
        // internals' perspective — regardless of whether the host itself passed a callback or
        // attached its own 'response' listener. Returning originalEmit's actual result here would
        // propagate `false` whenever there is no *real* listener on `req`; Node's internals treat
        // that as "nobody is consuming this response" and call `res._dump()` to discard the body,
        // racing with (and beating) the 'data' listener internalCapture just attached — silently
        // dropping every response captured this way down to zero bytes.
        originalEmit('response', delivered);
        return true;
      }
      return originalEmit(event, ...args);
    };
  } catch {
    onPatchFailure?.();
  }
}
