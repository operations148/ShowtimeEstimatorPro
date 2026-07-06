/**
 * Strip HTML tags from a string to prevent stored XSS.
 * Use on any user-supplied text that is stored and later rendered in a browser context.
 */
export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim();
}

/**
 * Sanitize an object's string values one level deep.
 * Returns a new object; does not mutate the input.
 */
export function sanitizeStrings<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = typeof value === 'string' ? stripHtml(value) : value;
  }
  return result as T;
}
