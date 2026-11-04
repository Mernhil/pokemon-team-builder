/** Links that come from data (the meta snapshot, tournament events) are shown only when they are plain http(s) addresses: never `javascript:` or `data:`. */
export function safeHttpUrl(url: unknown): string | undefined {
  if (typeof url !== 'string' || url.length > 2048) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}
