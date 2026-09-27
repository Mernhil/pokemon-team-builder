/**
 * Wild encounters from PKHeX's legality tables, for the games PokeAPI's encounter data doesn't cover
 * (Brilliant Diamond / Shining Pearl, Legends: Arceus, Scarlet / Violet + DLC, Legends: Z-A) or covers
 * only partly (Omega Ruby / Alpha Sapphire, Sun / Moon, Ultra Sun / Ultra Moon).
 *
 * The .pkl files are BinLinker containers (2-byte tag, u16 count, offset table); each entry is one
 * area. Layouts follow PKHeX.Core/Legality/Encounters/Templates/Gen*\/EncounterArea*.cs. PKHeX stores
 * which Pokémon appear where and at what level, not encounter rates.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensure } from './sources.js';

export interface PkhexEncounter {
  /** PokeAPI version identifier the rows belong to. */
  version: string;
  /** In-game location name (PKHeX's English location list). */
  location: string;
  method: string;
  species: number;
  form: number;
  min: number;
  max: number;
  conditions: string[];
}

const WILD = 'PKHeX.Core/Resources/legality/wild';
const LOC = 'PKHeX.Core/Resources/text/locations';

/** Entries of a BinLinker container (32-bit offsets, or 16-bit for Z-A's tables). */
function entries(buf: Buffer, wide = true): Buffer[] {
  const count = buf.readUInt16LE(2);
  const out: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const [start, end] = wide ? [buf.readUInt32LE(4 + i * 4), buf.readUInt32LE(8 + i * 4)] : [buf.readUInt16LE(4 + i * 2), buf.readUInt16LE(6 + i * 2)];
    out.push(buf.subarray(start, end));
  }
  return out;
}

const METHOD_6: Record<number, string> = {
  0: 'Wild',
  1: 'Walking in tall grass or a cave',
  2: 'Surfing',
  3: 'Fishing with an Old Rod',
  4: 'Fishing with a Good Rod',
  5: 'Fishing with a Super Rod',
  6: 'Smashing rocks',
  7: 'Horde encounter',
  8: 'Friend Safari',
};
const METHOD_8B: Record<number, string> = { ...METHOD_6, 7: 'Headbutting trees', 8: 'Slathering a Honey Tree with Honey' };
const METHOD_8A: Record<number, string> = {
  0: 'Roaming the wilds',
  1: 'Space-time distortion',
  2: 'Shaking trees, ore deposits and other landmarks',
  3: 'Mass outbreak',
  4: 'Massive mass outbreak',
};

/** Areas with a u16 location, u8 slot type, then 4-byte slots (species | form << 11, min, max): ORAS, SM/USUM, BDSP. */
function readClassic(file: string, version: string, names: string[], methods: Record<number, string>, extra: Partial<PkhexEncounter> = {}): PkhexEncounter[] {
  const out: PkhexEncounter[] = [];
  for (const area of entries(readFileSync(file))) {
    const location = names[area.readUInt16LE(0)];
    const method = extra.method ?? methods[area[2]] ?? 'Wild';
    for (let o = 4; o + 4 <= area.length; o += 4) {
      const raw = area.readUInt16LE(o);
      out.push({ version, location, method, species: raw & 0x3ff, form: raw >> 11, min: area[o + 2], max: area[o + 3], conditions: extra.conditions ?? [] });
    }
  }
  return out;
}

/** Legends: Arceus: u8 location count + locations, u8 type, u8 slot count, then 8-byte slots. */
function readLA(file: string, names: string[]): PkhexEncounter[] {
  const out: PkhexEncounter[] = [];
  for (const area of entries(readFileSync(file))) {
    const n = area[0];
    const locations = [...area.subarray(1, 1 + n)].map((l) => names[l]);
    let align = n + 1;
    align += align & 1;
    const type = area[align];
    const count = area[align + 1];
    for (let i = 0; i < count; i++) {
      const o = align + 2 + i * 8;
      const conditions = area[o + 3] ? ['Alpha'] : [];
      for (const location of locations)
        out.push({ version: 'legends-arceus', location, method: METHOD_8A[type] ?? 'Wild', species: area.readUInt16LE(o), form: area[o + 2], min: area[o + 4], max: area[o + 5], conditions });
    }
  }
  return out;
}

/** Scarlet/Violet: u8 location, u8 crossover, then 8-byte slots (species, form, gender, min, max, time, weather). */
function readSV(file: string, names: string[]): PkhexEncounter[] {
  const out: PkhexEncounter[] = [];
  for (const area of entries(readFileSync(file))) {
    const location = names[area[0]];
    for (let o = 4; o + 8 <= area.length; o += 8) {
      const row = { location, method: 'Roaming the wilds', species: area.readUInt16LE(o), form: area[o + 2], min: area[o + 4], max: area[o + 5], conditions: [] };
      out.push({ ...row, version: 'scarlet' }, { ...row, version: 'violet' });
    }
  }
  return out;
}

/** Legends: Z-A: u16 location, 2 reserved, then 8-byte slots (species, form, gender, min, max, alpha, shiny). */
function readZA(file: string, names: string[], method: string): PkhexEncounter[] {
  const out: PkhexEncounter[] = [];
  for (const area of entries(readFileSync(file), false)) {
    const location = names[area.readUInt16LE(0)];
    for (let o = 4; o + 8 <= area.length; o += 8)
      out.push({
        version: 'legends-za',
        location,
        method,
        species: area.readUInt16LE(o),
        form: area[o + 2],
        min: area[o + 4],
        max: area[o + 5],
        conditions: area[o + 6] === 1 ? ['Alpha'] : [],
      });
  }
  return out;
}

/** Every PKHeX-sourced encounter, keyed by PokeAPI version identifier. */
export function pkhexEncounters(): Map<string, PkhexEncounter[]> {
  const files = [
    ...['Gen6/encounter_or.pkl', 'Gen6/encounter_as.pkl', 'Gen7/encounter_sn.pkl', 'Gen7/encounter_mn.pkl', 'Gen7/encounter_us.pkl', 'Gen7/encounter_um.pkl'],
    ...['Gen8/encounter_bd.pkl', 'Gen8/encounter_sp.pkl', 'Gen8/encounter_bd_underground.pkl', 'Gen8/encounter_sp_underground.pkl', 'Gen8/encounter_la.pkl'],
    ...['Gen9/encounter_wild_paldea.pkl', 'Gen9/encounter_za.pkl', 'Gen9/encounter_hyperspace_za.pkl'],
  ].map((f) => `${WILD}/${f}`);
  const lists = ['gen6/text_xy_00000_en.txt', 'gen7/text_sm_00000_en.txt', 'gen8b/text_bdsp_00000_en.txt', 'gen8a/text_la_00000_en.txt', 'gen9/text_sv_00000_en.txt', 'gen9a/text_za_00000_en.txt'].map(
    (f) => `${LOC}/${f}`,
  );
  const dir = ensure('pkhex', [...files, ...lists]);
  const names = (f: string) => readFileSync(resolve(dir, LOC, f), 'utf8').split(/\r?\n/);
  const wild = (f: string) => resolve(dir, WILD, f);
  const xy = names('gen6/text_xy_00000_en.txt');
  const sm = names('gen7/text_sm_00000_en.txt');
  const bdsp = names('gen8b/text_bdsp_00000_en.txt');
  const za = names('gen9a/text_za_00000_en.txt');
  const underground = { method: 'Grand Underground', conditions: [] };

  const rows = [
    ...readClassic(wild('Gen6/encounter_or.pkl'), 'omega-ruby', xy, METHOD_6),
    ...readClassic(wild('Gen6/encounter_as.pkl'), 'alpha-sapphire', xy, METHOD_6),
    ...readClassic(wild('Gen7/encounter_sn.pkl'), 'sun', sm, { 0: 'Wild', 1: 'SOS Battle' }),
    ...readClassic(wild('Gen7/encounter_mn.pkl'), 'moon', sm, { 0: 'Wild', 1: 'SOS Battle' }),
    ...readClassic(wild('Gen7/encounter_us.pkl'), 'ultra-sun', sm, { 0: 'Wild', 1: 'SOS Battle' }),
    ...readClassic(wild('Gen7/encounter_um.pkl'), 'ultra-moon', sm, { 0: 'Wild', 1: 'SOS Battle' }),
    ...readClassic(wild('Gen8/encounter_bd.pkl'), 'brilliant-diamond', bdsp, METHOD_8B),
    ...readClassic(wild('Gen8/encounter_sp.pkl'), 'shining-pearl', bdsp, METHOD_8B),
    ...readClassic(wild('Gen8/encounter_bd_underground.pkl'), 'brilliant-diamond', bdsp, METHOD_8B, underground),
    ...readClassic(wild('Gen8/encounter_sp_underground.pkl'), 'shining-pearl', bdsp, METHOD_8B, underground),
    ...readLA(wild('Gen8/encounter_la.pkl'), names('gen8a/text_la_00000_en.txt')),
    ...readSV(wild('Gen9/encounter_wild_paldea.pkl'), names('gen9/text_sv_00000_en.txt')),
    ...readZA(wild('Gen9/encounter_za.pkl'), za, 'Wild Zone and city spawns'),
    ...readZA(wild('Gen9/encounter_hyperspace_za.pkl'), za, 'Hyperspace Lumiose (Mega Dimension)'),
  ];
  const byVersion = new Map<string, PkhexEncounter[]>();
  for (const r of rows) {
    if (!r.location || !r.species) continue;
    const list = byVersion.get(r.version) ?? [];
    list.push(r);
    byVersion.set(r.version, list);
  }
  return byVersion;
}
