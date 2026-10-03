/**
 * The meta (usage) data built into the app: the automated snapshot (generated/meta.json, from
 * `npm run meta`) and the hand-maintained file (meta/manual.json). Both are validated here, so a
 * bad file shows up as "no data" plus a console error rather than a broken tab. Never import this
 * module statically: it's loaded on first use through `useMetaFor` (./useMeta.ts), which keeps the
 * usage data out of the app's first download (a test checks).
 */
import generatedJson from './generated/meta.json';
import manualJson from './meta/manual.json';
import { parseMetaFile, pickSnapshot, type MetaFile, type MetaSnapshot } from '@/domain/meta';

function load(json: unknown, name: string): MetaFile | undefined {
  try {
    return parseMetaFile(json);
  } catch (e) {
    console.error(`Ignoring ${name}: ${(e as Error).message}`);
    return undefined;
  }
}

export const BAKED_META = load(generatedJson, 'generated/meta.json');
export const MANUAL_META = load(manualJson, 'meta/manual.json');

/**
 * Best snapshot for a regulation across a refreshed copy, the built-in automated file and the manual
 * one: the most trustworthy source (metaSourceRank: Smogon's stats, then hand-entered data, then the
 * early estimates), and of two from the same source the newer.
 */
export function metaFor(regulationId: string, refreshed?: MetaFile): MetaSnapshot | undefined {
  return pickSnapshot(regulationId, refreshed, BAKED_META, MANUAL_META);
}
