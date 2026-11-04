import type { MapsFile } from './RegionMap';

let mapsPromise: Promise<MapsFile> | undefined;
/** The hand-placed and rendered Area maps (one lazy chunk). */
export const loadMaps = () =>
  (mapsPromise ??= import('@/data/generated/maps.json').then((m) => m.default as unknown as MapsFile));
/** A file in `public/`, relative to wherever the app is served from. */
export const asset = (path: string) => `${import.meta.env.BASE_URL ?? './'}${path}`.replace(/^\/\//, '/');
