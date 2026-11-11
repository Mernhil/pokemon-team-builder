/**
 * Spike prototype (not app code): can the opponent's six be read from a screenshot of Pokémon
 * Champions' team preview? Run against a folder of screenshots:
 *
 *   npx tsx scripts/spikes/team-preview-recognition.ts /samples [--names names.txt]
 *
 * Each sample is `<name>.png|jpg` with `<name>.txt` next to it: the six species the screenshot
 * really shows, one per line, in any order (the ground truth). The script
 *   1. lists the samples and their ground truth,
 *   2. with `--ocr <name>.ocr.txt` files (the raw text an OCR engine produced for a sample, e.g.
 *      `tesseract sample.png - --psm 6 > sample.ocr.txt`) matches every OCR line against the
 *      regulation's species names (an allowlist, with a small edit-distance tolerance) and
 *      reports per-sample and overall accuracy: species found / six, false positives.
 * It never uploads anything and has no dependencies beyond Node: the OCR step is left to whatever
 * engine the spike evaluates (tesseract CLI, tesseract.js in a browser page, a platform OCR).
 * With no /samples folder it says so and stops; there is nothing to measure without screenshots.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

const dir = process.argv[2] ?? '/samples';
if (!existsSync(dir)) {
  console.log(`No sample folder at ${dir}: nothing to measure. Put 5–10 screenshots there (each with a .txt of the six species it shows) and run again.`);
  process.exit(0);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Levenshtein distance, early-out above `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const namesArg = process.argv.indexOf('--names');
const species: string[] = namesArg > 0
  ? readFileSync(process.argv[namesArg + 1], 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
  : Object.values((JSON.parse(readFileSync(resolve('src/data/generated/champions.json'), 'utf8')) as { species: Record<string, { name: string; isMega?: boolean }> }).species)
      .filter((s) => !s.isMega)
      .map((s) => s.name);
const allow = species.map((n) => ({ name: n, key: norm(n) }));

/** The species an OCR line most likely names: exact, else within 1 edit per 5 letters (min length 4). */
export function matchLine(line: string): string | undefined {
  const k = norm(line);
  if (k.length < 4) return undefined;
  const exact = allow.find((s) => s.key === k);
  if (exact) return exact.name;
  let best: { name: string; d: number } | undefined;
  for (const s of allow) {
    const max = Math.floor(s.key.length / 5);
    const d = distance(k, s.key, max);
    if (d <= max && (!best || d < best.d)) best = { name: s.name, d };
  }
  return best?.name;
}

const files = readdirSync(dir).filter((f) => /\.(png|jpe?g|webp|heic)$/i.test(f));
console.log(`${files.length} screenshot(s) in ${dir}`);
let found = 0, truth = 0, wrong = 0, withOcr = 0;
for (const f of files) {
  const stem = basename(f, extname(f));
  const truthFile = resolve(dir, `${stem}.txt`);
  const ocrFile = resolve(dir, `${stem}.ocr.txt`);
  const expected = existsSync(truthFile) ? readFileSync(truthFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean) : [];
  if (!existsSync(ocrFile)) {
    console.log(`- ${f}: ground truth ${expected.length ? expected.join(', ') : '(missing)'}; no ${stem}.ocr.txt yet`);
    continue;
  }
  withOcr++;
  const hits = new Set(readFileSync(ocrFile, 'utf8').split('\n').map(matchLine).filter((x): x is string => !!x));
  const right = expected.filter((e) => hits.has(e)).length;
  const extra = [...hits].filter((h) => !expected.includes(h)).length;
  found += right; truth += expected.length; wrong += extra;
  console.log(`- ${f}: ${right}/${expected.length} right, ${extra} wrong${expected.length ? '' : ' (no ground truth)'}`);
}
if (withOcr) console.log(`\nOverall: ${found}/${truth} species found (${truth ? Math.round((100 * found) / truth) : 0}%), ${wrong} false positives over ${withOcr} sample(s).`);
