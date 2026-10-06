import { metaSourceKind, parseMetaFile, type MetaFile, type MetaSnapshot } from './meta.ts';

/** A regulation may shrink to no less than this share of its previous entries. */
export const MIN_ENTRY_SHARE = 0.5;
/** The in-game data may trail the mirror's newest snapshot by at most this many days. */
export const MAX_MIRROR_LAG_DAYS = 2;

/**
 * Why a freshly built meta.json must not replace the previous one (empty = safe): it fails
 * validation, drops a regulation that had data, or shrinks one to less than half its entries.
 */
export function metaUpdateProblems(previous: MetaFile | undefined, next: unknown): string[] {
  let file: MetaFile;
  try {
    file = parseMetaFile(next);
  } catch (e) {
    return [e instanceof Error ? e.message : String(e)];
  }
  if (!previous) return [];
  const problems: string[] = [];
  for (const [id, was] of Object.entries(previous.regulations) as [string, MetaSnapshot][]) {
    const now = file.regulations[id];
    if (!now) {
      problems.push(`${id} had ${was.entries.length} entries and is gone.`);
    } else if (now.entries.length < was.entries.length * MIN_ENTRY_SHARE) {
      problems.push(`${id} shrank from ${was.entries.length} to ${now.entries.length} entries (under ${MIN_ENTRY_SHARE * 100}%).`);
    }
  }
  return problems;
}

const DAY = 86_400_000;

/** The newest in-game snapshot date (YYYY-MM-DD) in a meta file, if any regulation uses one. */
export function newestIngameDate(file: MetaFile): string | undefined {
  return (Object.values(file.regulations) as MetaSnapshot[])
    .filter((s) => metaSourceKind(s) === 'ingame')
    .map((s) => s.updatedAt.slice(0, 10))
    .sort()
    .at(-1);
}

/**
 * Days the in-game data in meta.json trails the mirror's newest snapshot (both YYYY-MM-DD).
 * Positive and above MAX_MIRROR_LAG_DAYS means the pipeline is not picking up what is there.
 */
export const mirrorLagDays = (mirrorNewest: string, metaNewest: string) =>
  Math.round((Date.parse(mirrorNewest) - Date.parse(metaNewest)) / DAY);
