export interface EmitLikeRequest {
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
    (req as any).emit = function (event: string, ...args: any[]): boolean {
      if (event === 'response' && !handled) {
        handled = true;
        return originalEmit('response', internalCapture(args[0]));
      }
      return originalEmit(event, ...args);
    };
  } catch {
    onPatchFailure?.();
  }
}
