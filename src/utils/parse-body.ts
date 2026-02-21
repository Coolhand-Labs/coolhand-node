export function parseBody(
  text: string | undefined | null
): Record<string, unknown> | string | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((item: unknown) => JSON.stringify(item)).join("\n");
    }
    return parsed as Record<string, unknown>;
  } catch {
    return text;
  }
}
