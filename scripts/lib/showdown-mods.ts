/**
 * Showdown's data mods straight from a checkout of its repository (data/mods/<name>/*.ts, plain
 * data object literals), for the parts @pkmn/mods doesn't have yet: the data build reads the
 * current Champions learnsets this way, and the audit (scripts/audit-data.ts) compares against it.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ModData } from '@pkmn/dex';

const TABLE_FILES = ['abilities', 'conditions', 'formats-data', 'items', 'learnsets', 'moves', 'rulesets', 'scripts'];

type Tables = Record<string, Record<string, Record<string, unknown>>>;

async function loadTables(repoDir: string, mod: string): Promise<Tables> {
  const tables: Tables = {};
  for (const f of TABLE_FILES) {
    const file = resolve(repoDir, 'data/mods', mod, `${f}.ts`);
    if (existsSync(file)) Object.assign(tables, await import(pathToFileURL(file).href));
  }
  return tables;
}

/**
 * A mod's tables on top of the one it inherits (`Scripts.inherit`), merged here the way Showdown
 * does: an entry replaces the parent's, an `inherit: true` entry is merged into it. Pass the
 * result to `Dex.mod(id, data)`.
 */
export async function loadShowdownMod(repoDir: string, mod: string): Promise<ModData> {
  const own = await loadTables(repoDir, mod);
  const parent = (own.Scripts as { inherit?: string } | undefined)?.inherit;
  if (!parent) return own as unknown as ModData;
  const base = (await loadShowdownMod(repoDir, parent)) as unknown as Tables;
  const out: Tables = { ...base };
  for (const [table, entries] of Object.entries(own)) {
    if (table === 'Scripts') {
      // The parent is merged in already; @pkmn/dex would otherwise look for it by name.
      out[table] = { ...entries, inherit: undefined } as unknown as Tables[string];
      continue;
    }
    const merged: Record<string, Record<string, unknown>> = { ...(base[table] ?? {}) };
    for (const [id, entry] of Object.entries(entries)) {
      merged[id] = entry.inherit === true && merged[id] ? { ...merged[id], ...entry } : entry;
    }
    out[table] = merged;
  }
  return out as unknown as ModData;
}
