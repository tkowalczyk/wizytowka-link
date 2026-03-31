/** Normalize Polish phone to +48XXXXXXXXX. Null if invalid. */
export function normalizePhone(raw: string): string | null {
  const stripped = raw.replace(/[\s\-]/g, '');
  if (/^\+48\d{9}$/.test(stripped)) return stripped;
  if (/^\d{9}$/.test(stripped)) return `+48${stripped}`;
  if (/^48\d{9}$/.test(stripped)) return `+${stripped}`;
  return null;
}
