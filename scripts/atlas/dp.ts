/**
 * Diamond / Pearl atlas (trainers only), from the pret/pokediamond decompilation:
 *   files/poketool/trainer/trdata.json   every trainer: class, name, party (level, species, item, moves, IV "difficulty")
 *   files/poketool/personal/{personal,wotbl}.json   types, abilities, gender ratios; level-up learnsets
 *   files/msgdata/msg/narc_0344 (item names), narc_0560 (trainer classes)
 *   arm9/src/trainer_data.c              how the game derives a trainer mon's personality → nature, ability, gender
 * The decompilation keeps zone events and scripts as compiled binaries, so nothing can be placed on the map:
 * there are no locations, items, NPCs or shops, and every trainer is listed as unplaced.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AtlasFile, AtlasItemInfo, AtlasMon, AtlasTrainer, TrainerKind } from '../../src/domain/atlasTypes.ts';
import { ensure } from '../sources.ts';
import { NATURES, cid, cleanText, readJSON, title } from './common.ts';

const COMMIT = '5bc4b1a3d8f100f77a4c64e59a0d544a0e29b3ec';
const read = (dir: string, f: string) => readFileSync(resolve(dir, f), 'utf8');

function defines(src: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of src.matchAll(/^#define\s+(\w+)\s+(-?\d+|0x[0-9a-fA-F]+)\b/gm)) out.set(m[1], Number(m[2]));
  return out;
}

/** `narc_0344_00001` → text, for one English GMM bank. */
function bank(dir: string, n: string): Map<number, string> {
  const out = new Map<number, string>();
  const src = read(dir, `files/msgdata/msg/${n}.gmm`);
  const dec = (s: string) => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (const m of src.matchAll(/<row id="[^"]+" index="(\d+)"[^>]*>[\s\S]*?<language name="English">([\s\S]*?)<\/language>/g)) out.set(Number(m[1]), dec(m[2]));
  return out;
}

const kindFor = (cls: string): TrainerKind =>
  /LEADER_/.test(cls) ? 'leader' : /ELITE_FOUR/.test(cls) ? 'elite-four' : /CHAMPION/.test(cls) ? 'champion' : /BARRY|RIVAL/.test(cls) ? 'rival' : /COMMANDER|GALACTIC/.test(cls) ? 'boss' : /PKMN_TRAINER_/.test(cls) ? 'other' : 'trainer';

export function buildDp(): { file: AtlasFile; gaps: string } {
  const dir = ensure('pokediamond', ['files/poketool', 'files/msgdata/msg', 'include/constants', 'arm9/src/trainer_data.c']);
  const itemNames = bank(dir, 'narc_0344');
  const classNames = bank(dir, 'narc_0560');
  const itemDefs = defines(read(dir, 'include/constants/items.h'));
  const trainerDefs = defines(read(dir, 'include/constants/trainers.h'));
  const classDefs = defines(read(dir, 'include/constants/trainer_classes.h'));
  const pid = (s: string) => s.replace(/^(SPECIES|MOVE|ITEM|ABILITY)_/, '');

  const personal = readJSON<{ baseStats: { species: string; types: string[]; abilities: string[]; genderRatio: number }[] }>(resolve(dir, 'files/poketool/personal/personal.json')).baseStats;
  const speciesNum = new Map(personal.map((p, i) => [p.species, i]));
  const learn = new Map(readJSON<{ wotbl: { species: string; moves: { move: string; level: number }[] }[] }>(resolve(dir, 'files/poketool/personal/wotbl.json')).wotbl.map((w) => [w.species, w.moves]));

  // class → gender selector (1 = female, 0x78; anything else 0x88)
  const genderTbl = [...(/sTrainerClassGenderCountTbl\[\]\s*=\s*\{([\s\S]*?)\};/.exec(read(dir, 'arm9/src/trainer_data.c'))?.[1] ?? '').matchAll(/\/\*(TRAINER_CLASS_\w+)\*\/\s*(\d+)/g)];
  const classGender = new Map(genderTbl.map((m) => [m[1], Number(m[2])]));

  const items: Record<string, AtlasItemInfo> = {};
  const itemId = (c: string): string => {
    const id = cid(c);
    const n = itemDefs.get(c);
    const name = n === undefined ? undefined : cleanText(itemNames.get(n) ?? '');
    items[id] ??= { name: name || title(pid(c).toLowerCase()), price: 0, description: '', pocket: '' };
    return id;
  };

  const tj = readJSON<{ trdata: { index: number; type: string; class: string; name: string; items: string[]; doubleBattle: number; party: { difficulty: number; level: number; species: string; item?: string; moves?: string[] }[] }[] }>(resolve(dir, 'files/poketool/trainer/trdata.json')).trdata;
  const constById = new Map<number, string>();
  for (const [k, v] of trainerDefs) if (k.startsWith('TRAINER_') && !constById.has(v)) constById.set(v, k);

  const trainers: Record<string, AtlasTrainer> = {};
  for (const t of tj) {
    const tid = constById.get(t.index);
    if (!t.party.length || !tid) continue;
    const classIdx = classDefs.get(t.class) ?? 0;
    const gender = classGender.get(t.class) === 1 ? 0x78 : 0x88;
    const party: AtlasMon[] = t.party.map((p) => {
      const name = pid(p.species);
      const sn = speciesNum.get(name) ?? 0;
      const sp = personal[sn];
      const mon: AtlasMon = { species: cid(p.species), level: p.level, iv: Math.floor((p.difficulty * 31) / 255), moves: [] };
      if (p.item && p.item !== 'ITEM_NONE') mon.item = itemId(p.item);
      if (p.moves?.length) mon.moves = p.moves.filter((m) => m !== 'MOVE_NONE').map(cid);
      else {
        const learned: string[] = [];
        for (const m of learn.get(name) ?? []) if (m.level <= p.level && !learned.includes(m.move)) learned.push(m.move);
        mon.moves = learned.slice(-4).map(cid);
        mon.movesDerived = true;
      }
      let state = (p.difficulty + p.level + sn + t.index) >>> 0;
      let rnd = state;
      for (let j = 0; j < classIdx; j++) {
        state = (Math.imul(state, 1103515245) + 24691) >>> 0;
        rnd = state >>> 16;
      }
      const pers = (((rnd << 8) >>> 0) + gender) >>> 0;
      mon.nature = NATURES[pers % 25];
      const [a1, a2] = sp.abilities;
      const ab = a2 && a2 !== 'ABILITY_NONE' ? (pers & 1 ? a2 : a1) : a1;
      if (ab && ab !== 'ABILITY_NONE') mon.ability = cid(ab);
      const g = sp.genderRatio;
      const ratio = g < 0 || g > 1 ? 255 : g === 0 ? 0 : g >= 1 ? 254 : Math.min(254, Math.floor(255 * g));
      mon.gender = ratio === 255 ? 'N' : ratio === 254 ? 'F' : ratio === 0 ? 'M' : (pers & 0xff) >= ratio ? 'M' : 'F';
      return mon;
    });
    const clsName = cleanText((classNames.get(classDefs.get(t.class) ?? -1) ?? '').replace(/₧₦/g, 'Pokémon')) || title(pid(t.class.replace('TRAINER_CLASS_', '')).toLowerCase());
    const rm = /^(TRAINER_\w+?)_(\d+)$/.exec(tid);
    const base = rm && trainerDefs.has(rm[1]) ? rm[1] : undefined;
    trainers[tid] = {
      id: tid, name: (t.class === 'TRAINER_CLASS_PKMN_TRAINER_BARRY' ? 'Barry' : t.name.replace(/\{TRNAME\}/g, '').trim()) || clsName, cls: clsName, kind: kindFor(t.class), party, group: base ?? tid, order: base ? Number(rm![2]) - 1 : 0,
      ...(base ? { variant: `Battle ${Number(rm![2])}` } : {}),
      ...(t.doubleBattle ? { double: true } : {}),
      ...(t.items?.length ? { bag: t.items.map(itemId) } : {}),
    };
  }

  const file: AtlasFile = {
    version: 1, game: 'diamond', name: 'Pokémon Diamond', generation: 4, source: { repo: 'pret/pokediamond', commit: COMMIT },
    locations: {}, trainers, items, unplaced: Object.keys(trainers), badges: [], unverified: {},
  };
  const gaps = [
    '# Atlas data gaps — Pokémon Diamond / Pearl',
    '',
    `Generated by \`npm run atlas\` (scripts/atlas/dp.ts); do not edit. Source: pret/pokediamond @ \`${COMMIT.slice(0, 10)}\`. Pearl uses this file too.`,
    '',
    '| What | Found | Expected | Notes |',
    '|---|---|---|---|',
    `| Trainers with full teams | ${Object.keys(trainers).length} | ${tj.filter((t) => t.party.length).length} | none are placed on a location |`,
    '| Locations, items, NPCs, shops, gyms | 0 | — | the decompilation keeps zone events and scripts as compiled binaries (`files/fielddata/**/narc_*.bin`), so none of it can be read |',
    '',
    '## Known limits',
    '',
    '- Trainers only: use Platinum for the same region with locations, items and NPCs.',
    '- Nature, ability and gender of trainer mons use the same personality rule as arm9/src/trainer_data.c; not cross-checked against a second source.',
    '- The rival is named after the player-chosen / story name; the data holds a placeholder ("Cedric"), so the Barry class is shown as Barry.',
    '- Trainer quotes are not read (the trainer message archive is binary).',
    '- Diamond and Pearl share trainer data; Pearl-only differences (personal_pearl) are not applied.',
    '',
  ].join('\n');
  return { file, gaps };
}
