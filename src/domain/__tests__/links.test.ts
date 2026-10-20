import { describe, expect, it } from 'vitest';
import { safeHttpUrl } from '@/domain/links';

describe('safeHttpUrl', () => {
  it('keeps http and https addresses', () => {
    expect(safeHttpUrl('https://play.limitlesstcg.com/tournament/abc')).toBe('https://play.limitlesstcg.com/tournament/abc');
    expect(safeHttpUrl('http://example.com')).toBe('http://example.com/');
  });
  it('drops anything else', () => {
    for (const u of ['javascript:alert(1)', ' javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd', 'vbscript:x', '//evil.example', 'not a url', '', 'https://' + 'a'.repeat(3000), null, undefined, 5, {}]) {
      expect(safeHttpUrl(u)).toBeUndefined();
    }
  });
});
