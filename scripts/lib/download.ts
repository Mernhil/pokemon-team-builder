import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Downloads `url` to `file` once, retrying a few times. An empty file in the cache means "404, don't ask again";
 * a 404 returns null (and is cached that way), any other failure throws after three attempts.
 */
export async function cachedDownload(file: string, url: string): Promise<Buffer | null> {
  if (existsSync(file)) {
    const buf = readFileSync(file);
    return buf.length ? buf : null; // empty file = cached 404
  }
  mkdirSync(dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) {
        writeFileSync(file, '');
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(file, buf);
      return buf;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return null;
}
