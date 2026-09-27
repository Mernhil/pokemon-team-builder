/**
 * Loads a generated data file (src/data/generated/<name>.json).
 *
 * Normal builds code-split each file into its own chunk. The single-file build (the hosted claude.ai
 * app) can't inline ~16 MB of data, so there the files are published next to the page under data/
 * (scripts/build-artifact.mjs) and fetched on demand — like the sprite atlases.
 */
export const SIDE_LOADED_DATA = import.meta.env.MODE === 'singlefile';

export function fetchGenerated<T>(name: string): Promise<T> {
  const url = `${import.meta.env.BASE_URL ?? './'}data/${name}.json`.replace(/^\/\//, '/');
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Couldn't load ${name} (HTTP ${r.status})`);
    return r.json() as Promise<T>;
  });
}
