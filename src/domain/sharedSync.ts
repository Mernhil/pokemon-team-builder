/**
 * Client-side rules for teams in other people's shared folders. A folder I can only view is mirrored
 * exactly (whatever the owner has, I have); a folder I can edit goes through the ordinary merge in
 * src/sync/engine.ts. Pure and React-free.
 */
import { docKey, type Known, type LocalDoc } from './sync';
import type { RemoteDocument } from './syncProtocol';
import type { Team } from './types';

export const folderKey = (owner: string, folderId: string) => `${owner}|${folderId}`;

/** The local teams that belong to one shared folder. */
export const teamsOfFolder = (teams: Record<string, Team>, owner: string, folderId: string): Team[] =>
  Object.values(teams).filter((t) => t.shared && t.shared.owner === owner && t.shared.folderId === folderId);

export interface ViewerResult {
  upserts: LocalDoc[];
  deletes: { kind: 'team'; id: string }[];
  /** What is known to be in sync afterwards (so becoming an editor later starts from a clean base). */
  known: Record<string, Known>;
  /** Teams that changed since the last time (not counting ones that are new to me). */
  updated: { id: string; name: string; updatedAt: number; by?: string }[];
}

/** Mirrors a folder I can only view: the server's live documents replace mine, anything it lacks or deleted goes. */
export function reconcileViewer(local: LocalDoc[], remote: RemoteDocument[]): ViewerResult {
  const mine = new Map(local.map((d) => [d.id, d]));
  const upserts: LocalDoc[] = [];
  const deletes: ViewerResult['deletes'] = [];
  const known: Record<string, Known> = {};
  const updated: ViewerResult['updated'] = [];
  const live = new Set<string>();
  for (const r of remote) {
    if (r.kind !== 'team' || r.deleted || r.json === undefined) continue;
    live.add(r.id);
    known[docKey('team', r.id)] = { updatedAt: r.updatedAt };
    const cur = mine.get(r.id);
    if (cur && cur.updatedAt === r.updatedAt) continue;
    upserts.push({ id: r.id, kind: 'team', updatedAt: r.updatedAt, json: r.json });
    if (cur && r.updatedAt > cur.updatedAt) updated.push({ id: r.id, name: (r.json as Team).name, updatedAt: r.updatedAt, by: r.by });
  }
  for (const d of local) if (!live.has(d.id)) deletes.push({ kind: 'team', id: d.id });
  return { upserts, deletes, known, updated };
}
