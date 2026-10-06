/**
 * Safety checks for the daily meta job (.github/workflows/meta.yml), run after `npm run meta`:
 *
 *   npm run meta:check            guard: the new meta.json must validate and must not lose or halve
 *                                 a regulation compared with the committed one (exit 1 otherwise)
 *   npm run meta:check -- --lag   stall check: the in-game data must be within MAX_MIRROR_LAG_DAYS of
 *                                 the mirror's newest snapshot (exit 1 otherwise)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { parseMetaFile, type MetaFile } from '../src/domain/meta.ts';
import { ingameDate } from '../src/domain/metaSources.ts';
import { MAX_MIRROR_LAG_DAYS, metaUpdateProblems, mirrorLagDays, newestIngameDate } from '../src/domain/metaGuard.ts';
import { getJson } from './meta/http.ts';

const PATH = 'src/data/generated/meta.json';
const BASE = (process.env.INGAME_DATA_BASE || 'https://raw.githubusercontent.com/Gheist23/pokemonbattledata/main/data/meta').replace(/\/$/, '');

const current = JSON.parse(readFileSync(PATH, 'utf8')) as unknown;

function committed(): MetaFile | undefined {
  try {
    return parseMetaFile(JSON.parse(execFileSync('git', ['show', `HEAD:${PATH}`], { encoding: 'utf8', maxBuffer: 64 << 20 })));
  } catch {
    return undefined; // no previous version (first commit, or not a git checkout)
  }
}

if (process.argv.includes('--lag')) {
  const file = parseMetaFile(current);
  const index = z
    .object({ seasons: z.array(z.object({ formats: z.array(z.string()).default([]), dates: z.array(z.string().regex(/^\d{2}_\d{2}_\d{4}$/)) })) })
    .safeParse(await getJson(`${BASE}/index.json`));
  const mirror = index.success ? index.data.seasons.filter((s) => s.formats.includes('Doubles')).flatMap((s) => s.dates.map(ingameDate)).sort().at(-1) : undefined;
  const ours = newestIngameDate(file);
  if (!mirror || !ours) {
    console.log(`Stall check skipped (mirror newest: ${mirror ?? 'unreadable'}, meta.json in-game: ${ours ?? 'none'}).`);
  } else {
    const lag = mirrorLagDays(mirror, ours);
    console.log(`Mirror newest ${mirror}, meta.json in-game data ${ours}: ${lag} day(s) behind.`);
    if (lag > MAX_MIRROR_LAG_DAYS) {
      console.error(`::error::The in-game data is ${lag} days behind the mirror (limit ${MAX_MIRROR_LAG_DAYS}). The pipeline is not picking up new snapshots.`);
      process.exit(1);
    }
  }
} else {
  const problems = metaUpdateProblems(committed(), current);
  if (problems.length) {
    for (const p of problems) console.error(`::error::Refusing the new meta.json: ${p}`);
    process.exit(1);
  }
  console.log('meta.json passes the guard.');
}
