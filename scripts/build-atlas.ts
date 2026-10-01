/**
 * Atlas data: locations, items, NPCs, shops and every trainer's team, per game.
 * Each game has its own builder in scripts/atlas/<game>.ts reading that game's pret decompilation
 * (pinned in scripts/sources.ts); this driver writes src/data/generated/atlas-<game>.json and
 * docs/data-gaps/<game>.md. Nothing is invented: what a source doesn't settle is listed as unverified.
 *   npm run atlas            every game
 *   npm run atlas -- emerald one game
 * Run after `npm run data`, `npm run pokedex` and `npm run maps` (location ids are maps.json place ids).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AtlasFile } from '../src/domain/atlasTypes.ts';
import { GAPS, OUT } from './atlas/common.ts';
import { buildEmerald, buildFireRed, buildRuby } from './atlas/gba.ts';
import { buildRed, buildYellow } from './atlas/gen1.ts';
import { buildCrystal, buildGold } from './atlas/gen2.ts';
import { buildHgss } from './atlas/hgss.ts';
import { buildDp } from './atlas/dp.ts';
import { buildPlatinum } from './atlas/platinum.ts';
import { LITE_GAMES, buildEncounters } from './atlas/encounters.ts';

const BUILDERS: Record<string, () => { file: AtlasFile; gaps: string }> = {
  platinum: buildPlatinum,
  emerald: buildEmerald,
  firered: buildFireRed,
  ruby: buildRuby,
  red: buildRed,
  yellow: buildYellow,
  crystal: buildCrystal,
  gold: buildGold,
  heartgold: buildHgss,
  diamond: buildDp,
  // Generation 5 onward: encounters only (scripts/atlas/encounters.ts).
  ...Object.fromEntries(LITE_GAMES.map((g) => [g.id, () => buildEncounters(g)])),
};

function main() {
  mkdirSync(GAPS, { recursive: true });
  const wanted = process.argv[2] ? [process.argv[2]] : Object.keys(BUILDERS);
  for (const game of wanted) {
    if (!BUILDERS[game]) throw new Error(`No atlas builder for ${game} (have ${Object.keys(BUILDERS).join(', ')})`);
    const { file, gaps } = BUILDERS[game]();
    writeFileSync(resolve(OUT, `atlas-${game}.json`), JSON.stringify(file));
    writeFileSync(resolve(GAPS, `${game}.md`), gaps);
    const L = Object.values(file.locations);
    if (LITE_GAMES.some((g) => g.id === game)) {
      console.log(`${game}: ${Object.keys(file.locations).length} locations (encounters only)`);
      continue;
    }
    console.log(
      `${game}: ${L.length} locations, ${Object.keys(file.trainers).length} trainers (${file.unplaced.length} unplaced), ` +
        `${L.reduce((n, l) => n + l.items.length, 0)} item spots, ${L.reduce((n, l) => n + l.npcs.length, 0)} NPCs, ${L.reduce((n, l) => n + l.shops.length, 0)} shops`,
    );
  }
}
main();
