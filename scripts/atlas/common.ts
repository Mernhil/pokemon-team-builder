/**
 * Helpers shared by the per-game atlas builders (scripts/atlas/<game>.ts).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const OUT = resolve(ROOT, 'src/data/generated');
export const GAPS = resolve(ROOT, 'docs/data-gaps');


export const readJSON = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8')) as T;
export const lines = (f: string) => readFileSync(f, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
/** SPECIES_MR_MIME → mrmime, ITEM_POKE_BALL → pokeball: the Showdown id of a decomp constant. */
export const cid = (c: string) => {
  const id = c.replace(/^(SPECIES|MOVE|ITEM|ABILITY)_/, '').replace(/_/g, '').toLowerCase();
  return DECOMP_ALIASES[id] ?? id;
};
/** Decomp constants that are spelled differently from Showdown's ids. */
export const DECOMP_ALIASES: Record<string, string> = { faintattack: 'feintattack', hijumpkick: 'highjumpkick', smellingsalt: 'smellingsalts' };
export const title = (s: string) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const spaced = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');

export const NATURES = ['hardy', 'lonely', 'brave', 'adamant', 'naughty', 'bold', 'docile', 'relaxed', 'impish', 'lax', 'timid', 'hasty', 'serious', 'jolly', 'naive', 'modest', 'mild', 'quiet', 'bashful', 'rash', 'calm', 'gentle', 'sassy', 'careful', 'quirky'];
export const GENDER_RATIO: Record<string, number> = { FEMALE_12_5: 31, FEMALE_25: 63, FEMALE_50: 127, FEMALE_75: 191, FEMALE_ONLY: 254, MALE_ONLY: 0, NO_GENDER: 255 };

/** Text messages of a message bank with the game's control codes made readable. */
export function cleanText(parts: string | string[]): string {
  const raw = Array.isArray(parts) ? parts.join('') : parts;
  return raw
    .replace(/\{STRVAR_1 \d+, \d+, \d+\}/g, '[name]')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\[nr]|[\n\r]+(?=\S)/g, (m) => (m.includes('r') ? '\n' : ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();
}

