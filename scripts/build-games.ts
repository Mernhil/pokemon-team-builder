/**
 * Datasets for the main-series games that aren't their generation's "main" pair (called from
 * build-data.ts), each built from Pokémon Showdown's mod for that game:
 *
 *   lgpe  Let's Go, Pikachu! / Let's Go, Eevee!   gen7letsgo (@pkmn/mods)   Kanto 151 + Meltan/Melmetal,
 *                                                                          Alolan forms, Megas; no abilities,
 *                                                                          no held items (Mega Stones only)
 *   bdsp  Brilliant Diamond / Shining Pearl        gen8bdsp  (Showdown)     Sinnoh remakes, SwSh mechanics
 *   pla   Legends: Arceus                          gen8legends (Showdown)   Hisui; no abilities, no held items
 *   za    Legends: Z-A (+ Mega Dimension)          gen9legends (Showdown)   Lumiose; new Megas; no abilities;
 *                                                                          held items = PKHeX's Z-A item pouches
 *
 * The Showdown mods not published on npm are read from a pinned checkout (scripts/sources.ts).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Dex, type ModData } from '@pkmn/dex';
import * as LetsGoMod from '@pkmn/mods/gen7letsgo';
import { type AnyDex, writeDataset } from './build-gens.js';
import { ensure } from './sources.js';
import { toID } from '../src/domain/id.ts';

const MOD_FILES: [string, keyof ModData | 'Species'][] = [
  ['formats-data', 'FormatsData'],
  ['learnsets', 'Learnsets'],
  ['moves', 'Moves'],
  ['items', 'Items'],
  ['abilities', 'Abilities'],
  ['pokedex', 'Species'],
];

type Table = Record<string, Record<string, unknown>>;
interface GameMod {
  dex: AnyDex;
  /** The species the game has: listed in the mod's FormatsData and not flagged nonstandard. */
  roster: (id: string) => boolean;
  learnsets: Record<string, { learnset?: Record<string, string[]> }>;
}

/**
 * Load a Showdown data mod (plain data files) on top of generation `gen`. Like Showdown's own loader,
 * entries the mod doesn't list are inherited from the parent generation (@pkmn/dex doesn't do this).
 */
async function showdownMod(name: string, gen: number): Promise<GameMod> {
  const dir = ensure('showdown', [`data/mods/${name}`]);
  const tables: Record<string, Table> = {};
  for (const [file, key] of MOD_FILES) {
    const path = resolve(dir, 'data/mods', name, `${file}.ts`);
    try {
      readFileSync(path);
    } catch {
      continue;
    }
    tables[key] = Object.values((await import(pathToFileURL(path).href)) as Record<string, Table>)[0];
  }
  return gameMod(name, gen, tables);
}

function gameMod(name: string, gen: number, tables: Record<string, Table>): GameMod {
  const parent = Dex.forGen(gen as 8).data as unknown as Record<string, Table>;
  const own = tables.FormatsData ?? {};
  const data = {
    ...tables,
    // Keep the parent's tier under each mod entry: @pkmn/dex needs one for formes whose battleOnly
    // is a list (Zygarde-Complete).
    FormatsData: { ...parent.FormatsData, ...Object.fromEntries(Object.entries(own).map(([id, e]) => [id, { ...parent.FormatsData[id], ...e }])) },
    Scripts: { gen, inherit: `gen${gen}` },
  };
  return {
    dex: Dex.mod(name as never, data as unknown as ModData) as unknown as AnyDex,
    roster: (id) => id in own && !own[id].isNonstandard,
    learnsets: (tables.Learnsets ?? {}) as GameMod['learnsets'],
  };
}

/** Items Legends: Z-A lets a Pokémon hold (PKHeX ItemStorage9ZA: Items, Berries, Mega Stones). */
function zaHeldItems(): Set<string> {
  const dir = ensure('pkhex', ['PKHeX.Core/Items/ItemStorage9ZA.cs', 'PKHeX.Core/Resources/text/items/text_Items_en.txt']);
  const src = readFileSync(resolve(dir, 'PKHeX.Core/Items/ItemStorage9ZA.cs'), 'utf8');
  const names = readFileSync(resolve(dir, 'PKHeX.Core/Resources/text/items/text_Items_en.txt'), 'utf8').split(/\r?\n/);
  const list = (pouch: string) => {
    const body = src.match(new RegExp(`${pouch} =>[^\\[]*\\[([\\s\\S]*?)\\];`))?.[1] ?? '';
    // Items after a "cannot be held" comment are the pouch's non-holdable extras.
    return [...body.split('\n').filter((l) => !/cannot be held/i.test(l)).join('\n').matchAll(/\b0*(\d+)\b/g)].map((m) => Number(m[1]));
  };
  return new Set([...list('Other'), ...list('Berry'), ...list('MegaStones')].map((id) => toID(names[id])).filter(Boolean));
}

export async function buildGames(outDir: string) {
  const letsgo = gameMod('gen7letsgo', 7, LetsGoMod as unknown as Record<string, Table>);
  await writeDataset(outDir, {
    id: 'lgpe',
    generation: 7,
    ...letsgo,
    source: "Pokémon Showdown gen7letsgo (Let's Go, Pikachu! / Let's Go, Eevee!)",
    abilities: 'none',
    // No held items in Let's Go; a Mega Stone in the bag lets its Pokémon Mega Evolve.
    heldItem: (i) => i.exists && !i.isNonstandard && !!i.megaStone,
    natures: true,
    megas: true,
  });

  await writeDataset(outDir, {
    id: 'bdsp',
    generation: 8,
    ...(await showdownMod('gen8bdsp', 8)),
    source: 'Pokémon Showdown gen8bdsp (Brilliant Diamond / Shining Pearl)',
    abilities: 'all',
  });

  await writeDataset(outDir, {
    id: 'pla',
    generation: 8,
    ...(await showdownMod('gen8legends', 8)),
    source: 'Pokémon Showdown gen8legends (Legends: Arceus)',
    abilities: 'none',
    heldItem: () => false,
  });

  const za = zaHeldItems();
  await writeDataset(outDir, {
    id: 'za',
    generation: 9,
    ...(await showdownMod('gen9legends', 9)),
    source: 'Pokémon Showdown gen9legends (Legends: Z-A) + PKHeX Z-A item pouches',
    abilities: 'none',
    heldItem: (i) => i.exists && za.has(i.id),
    megas: true,
  });
}
