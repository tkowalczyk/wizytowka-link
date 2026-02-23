export function generateOwnerToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return 'biz_' + Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 32);
}
