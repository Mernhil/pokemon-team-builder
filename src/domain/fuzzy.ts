/**
 * Small fuzzy matcher for the command palette: every word of the query has to match, a word at the
 * start of the text or of one of its words beats a match in the middle, which beats letters that
 * only appear in order ("tbld" for "Team builder"). Accents and punctuation are ignored.
 */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** How well one word matches `text` (already folded): higher is better, null is no match. */
function wordScore(word: string, text: string): number | null {
  if (text === word) return 100;
  if (text.startsWith(word)) return 80;
  const at = text.indexOf(` ${word}`);
  if (at >= 0) return 60 - Math.min(at, 20) * 0.5;
  const inside = text.indexOf(word);
  if (inside >= 0) return 40 - Math.min(inside, 20) * 0.5;
  if (word.length >= 3) {
    let from = 0;
    for (const ch of word) {
      from = text.indexOf(ch, from) + 1;
      if (from === 0) return null;
    }
    return 10;
  }
  return null;
}

/** The score of a query against a text, or null when some word of the query does not match. An empty query matches everything equally. */
export function fuzzyScore(query: string, text: string): number | null {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return 0;
  const t = fold(text);
  let total = 0;
  for (const w of words) {
    const s = wordScore(w, t);
    if (s === null) return null;
    total += s;
  }
  return total / words.length - t.length * 0.01;
}

/** The items that match, best first (ties keep their order), at most `limit`. */
export function fuzzyRank<T>(query: string, items: readonly T[], textOf: (item: T) => string, limit = Infinity): T[] {
  const scored: { item: T; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const score = fuzzyScore(query, textOf(item));
    if (score !== null) scored.push({ item, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((s) => s.item);
}
