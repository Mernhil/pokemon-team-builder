/**
 * `npm run meta`: builds src/data/generated/meta.json (the Meta tab's usage data) from Smogon's
 * monthly usage statistics, https://www.smogon.com/stats/ — the "chaos" JSON files, which come
 * from rated battles on the Pokémon Showdown ladder.
 *
 * For every Champions regulation in src/data/generated/regulations.json it looks, newest month
 * first, for that regulation's Showdown VGC format (e.g. "[Gen 9 Champions] VGC 2026 Reg M-C" →
 * gen9championsvgc2026regmc, then its Bo3 variant) at the highest rating cutoff published, and
 * normalises it with chaosToSnapshot (src/domain/meta.ts). Regulations without published stats
 * keep whatever the previous meta.json had; nothing is invented. Species Showdown names that the
 * Champions dataset doesn't know are dropped and listed.
 *
 *   npm run meta              all Champions regulations
 *   npm run meta -- --months 3   only look back 3 months (default 8)
 *
 * Needs network access to www.smogon.com (the scheduled GitHub Action has it). See
 * docs/UPDATING_META.md.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chaosToSnapshot, parseMetaFile, type MetaFile, type MetaSnapshot } from '../src/domain/meta.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/data/generated/meta.json');
const STATS = 'https://www.smogon.com/stats/';
/** Smogon's VGC cutoffs, best first. */
const CUTOFFS = [1760, 1630, 1500, 0];

const monthsBack = Number(process.argv[process.argv.indexOf('--months') + 1]) || 8;

const toID = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

interface Regulation {
  id: string;
  game: string;
  shortName: string;
}
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'src/data/generated/regulations.json'), 'utf8')) as { regulations: Regulation[] };
const dataset = JSON.parse(readFileSync(resolve(ROOT, 'src/data/generated/champions.json'), 'utf8')) as {
  species: Record<string, { id: string; name: string; baseSpecies: string; isMega: boolean; battleOnly?: string }>;
};

/** Showdown species name → this app's Champions species id (Megas count as their base forme). */
function speciesId(name: string): string | undefined {
  const sp = dataset.species[toID(name)];
  if (!sp) return undefined;
  return sp.isMega && sp.battleOnly ? sp.battleOnly : sp.id;
}

async function get(url: string): Promise<Response | null> {
  const res = await fetch(url, { headers: { 'User-Agent': 'pokemon-team-builder meta build (+https://github.com/Mernhil/pokemon-team-builder)' } });
  return res.ok ? res : null;
}

/** Stats months on the index page, newest first ("2026-08", …; the -DLC variants are skipped). */
async function listMonths(): Promise<string[]> {
  const res = await get(STATS);
  if (!res) throw new Error(`Couldn't read ${STATS}`);
  const html = await res.text();
  return [...new Set([...html.matchAll(/href="(\d{4}-\d{2})\/"/g)].map((m) => m[1]))].sort().reverse();
}

/** Showdown format ids for a Champions regulation id (champions-reg-mc → …vgc2026regmc, …bo3). */
function formatIds(reg: Regulation): string[] {
  const letters = reg.id.replace(/^champions-reg-/, '');
  const year = '2026'; // TODO: take the season from the regulation once a Champions regulation spans another VGC year.
  const base = `gen9championsvgc${year}reg${letters}`;
  return [base, `${base}bo3`];
}

async function findChaos(reg: Regulation, months: string[]) {
  for (const month of months.slice(0, monthsBack)) {
    for (const format of formatIds(reg)) {
      for (const cutoff of CUTOFFS) {
        const url = `${STATS}${month}/chaos/${format}-${cutoff}.json`;
        const res = await get(url);
        if (res) return { month, format, cutoff, url, json: (await res.json()) as unknown };
      }
    }
  }
  return null;
}

const previous: MetaFile = existsSync(OUT) ? parseMetaFile(JSON.parse(readFileSync(OUT, 'utf8'))) : { version: 1, generatedAt: '1970-01-01', regulations: {} };
const months = await listMonths();
console.log(`Smogon stats months (newest first): ${months.slice(0, monthsBack).join(', ')}`);

const regulations: Record<string, MetaSnapshot> = { ...previous.regulations };
const unknown = new Set<string>();
for (const reg of manifest.regulations.filter((r) => r.game === 'champions')) {
  const found = await findChaos(reg, months);
  if (!found) {
    console.log(`${reg.shortName}: no published stats yet${regulations[reg.id] ? ' (keeping the previous snapshot)' : ''}.`);
    continue;
  }
  const snap = chaosToSnapshot(found.json, {
    regulationId: reg.id,
    format: found.format,
    month: found.month,
    url: found.url,
    speciesId: (name: string) => {
      const sid = speciesId(name);
      if (!sid) unknown.add(name);
      return sid;
    },
  });
  regulations[reg.id] = snap;
  console.log(`${reg.shortName}: ${found.format} ${found.month} ≥${found.cutoff}, ${snap.source.battles} battles, ${snap.entries.length} Pokémon.`);
}
if (unknown.size) console.log(`Not in the Champions dataset (dropped): ${[...unknown].sort().join(', ')}`);

const out: MetaFile = { version: 1, generatedAt: new Date().toISOString().slice(0, 10), regulations };
parseMetaFile(out); // never write a file the app would reject
const unchanged = JSON.stringify(previous.regulations) === JSON.stringify(regulations);
if (unchanged) console.log('No change in the data.');
else writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(unchanged ? 'meta.json left as is.' : `wrote ${OUT}`);
