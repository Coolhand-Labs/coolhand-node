/**
 * Extracts a loggable message from a caught `unknown` value. `catch` bindings aren't
 * guaranteed to be `Error` instances (a rejection can be a string, a plain object, etc.),
 * so a bare `(error as Error).message` cast can silently produce `undefined`.
 */
export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
