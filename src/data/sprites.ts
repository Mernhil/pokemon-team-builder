import { useEffect, useState } from 'react';
import type { SpriteSetId } from '@/domain/types';

/**
 * Runtime side of the sprite atlases built by scripts/build-sprites.ts.
 * Each set = public/sprites/<set>.webp (grid of fixed-size cells) + <set>.json (id → cell index).
 * Paths are relative so the app works from any base path, offline, and in sandboxed hosts.
 */
export interface SpriteSheet {
  set: SpriteSetId;
  label: string;
  cell: number;
  cols: number;
  rows: number;
  pixelated: boolean;
  count: number;
  index: Record<string, number>;
  url: string;
}

export const SPRITE_SETS: { id: SpriteSetId; label: string; gen?: number }[] = [
  { id: 'gen1', label: 'Red / Blue', gen: 1 },
  { id: 'gen2', label: 'Crystal', gen: 2 },
  { id: 'gen3', label: 'Emerald', gen: 3 },
  { id: 'gen4', label: 'Platinum', gen: 4 },
  { id: 'gen5', label: 'Black / White', gen: 5 },
  { id: 'gen6', label: 'X / Y', gen: 6 },
  { id: 'gen7', label: 'HOME', gen: 7 },
  { id: 'gen8', label: 'HOME', gen: 8 },
  { id: 'gen9', label: 'Scarlet / Violet', gen: 9 },
  { id: 'champions', label: 'Champions' },
];

const base = () => `${import.meta.env.BASE_URL ?? './'}sprites/`.replace(/^\/\//, '/');
const cache = new Map<string, Promise<SpriteSheet | null>>();

function loadSheet(id: string): Promise<SpriteSheet | null> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(`${base()}${id}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((meta) => {
        if (!meta) {
          cache.delete(id);
          return null;
        }
        const sheet = { ...meta, url: `${base()}${id}.webp` } as SpriteSheet;
        // Warm the image so the first paint of every sprite comes from cache.
        const img = new Image();
        img.src = sheet.url;
        return sheet;
      })
      .catch(() => {
        // Transient network failure: let the next request retry instead of caching "no sprites".
        cache.delete(id);
        return null;
      });
    cache.set(id, p);
  }
  return p;
}

export function loadSpriteSheet(set: SpriteSetId): Promise<SpriteSheet | null> {
  return loadSheet(set);
}

/** Subscribe to a sprite sheet; returns null while loading or if the set isn't available. */
export function useSpriteSheet(set: SpriteSetId | undefined): SpriteSheet | null {
  // Stored with the set it belongs to, so switching sets reads as "loading" at once, without a reset in the effect.
  const [loaded, setLoaded] = useState<{ set: SpriteSetId; sheet: SpriteSheet | null }>();
  useEffect(() => {
    let alive = true;
    if (set) loadSpriteSheet(set).then((sheet) => alive && setLoaded({ set, sheet }));
    return () => {
      alive = false;
    };
  }, [set]);
  return set && loaded?.set === set ? loaded.sheet : null;
}

/** Item icon atlas built by scripts/build-items.ts (public/sprites/items.{webp,json}). */
function loadItemSheet(): Promise<SpriteSheet | null> {
  return loadSheet('items');
}

/** Subscribe to the item icon atlas; returns null while loading or if it isn't available. */
export function useItemSheet(): SpriteSheet | null {
  const [sheet, setSheet] = useState<SpriteSheet | null>(null);
  useEffect(() => {
    let alive = true;
    loadItemSheet().then((s) => alive && setSheet(s));
    return () => {
      alive = false;
    };
  }, []);
  return sheet;
}
