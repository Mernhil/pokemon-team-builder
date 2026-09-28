/**
 * The meta (usage) data built into the app: the automated snapshot (generated/meta.json, from
 * `npm run meta`) and the hand-maintained file (meta/manual.json). Both are validated here, so a
 * bad file shows up as "no data" plus a console error rather than a broken tab. Import this module
 * lazily (it's only needed by the Meta tab and meta-backed hints).
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

/** Best snapshot for a regulation: a refreshed copy, then the built-in automated one, then the manual one. */
export function metaFor(regulationId: string, refreshed?: MetaFile): MetaSnapshot | undefined {
  return pickSnapshot(regulationId, refreshed, BAKED_META) ?? pickSnapshot(regulationId, MANUAL_META);
}
