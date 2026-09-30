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
import { buildEmerald } from './atlas/emerald.ts';
import { buildPlatinum } from './atlas/platinum.ts';

const BUILDERS: Record<string, () => { file: AtlasFile; gaps: string }> = {
  platinum: buildPlatinum,
  emerald: buildEmerald,
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
    console.log(
      `${game}: ${L.length} locations, ${Object.keys(file.trainers).length} trainers (${file.unplaced.length} unplaced), ` +
        `${L.reduce((n, l) => n + l.items.length, 0)} item spots, ${L.reduce((n, l) => n + l.npcs.length, 0)} NPCs, ${L.reduce((n, l) => n + l.shops.length, 0)} shops`,
    );
  }
}
main();
