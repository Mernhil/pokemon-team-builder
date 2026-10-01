# Pokénav: data sources for Generation 5 onward

Pokénav (Red … Platinum, 16 games) is built from pret's decompilations (`scripts/atlas/*`). Survey of what
exists for the remaining games, as of this writing:

| Need | Gen 5 – 9 status |
| --- | --- |
| Region map image | No decompilation, so no pret map data. Would need hand-placed schematics (`src/data/maps/*.json`) or a ripped source. |
| Locations, wild / static encounters | Already in `pokedex-gen5…9.json` (PKHeX + PokeAPI); the Pokédex *Area* page shows them. Pokénav would only repeat it. |
| Trainer teams, gyms, items, shops | **No source among the pinned repos.** PKHeX has encounter tables only, no trainer parties; Showdown has none; PokeAPI has no trainers. |

Candidate sources that would unblock it (none are pinned yet, each needs a decision on licence and reachability):

- pkNX (kwsch/pkNX) reads trainer / item / map data from a game dump, so it needs ROM files.
- A community trainer-team dataset (e.g. derived from Bulbapedia / Serebii), which must be reachable from the build environment and acceptable to redistribute.

Nothing is invented. Until one of these is chosen, Gen 5+ games are **encounters only** (`AtlasGame.lite`,
`scripts/atlas/encounters.ts`): a searchable list of the places that have encounters, with every wild, static, gift
and trade Pokémon from the Pokédex data, plus a visited-places tracker. No map, items, NPCs, shops or trainers.

## Map artwork (Generation 5 onward)

No decompilation means no map to render, so the maps behind the lists come from two places:

- **Supplied screenshots** in `src-assets/maps/<name>.png` with a `<name>.json` next to each (crop, output width, the map whose places
  are carried over, the games that show it, and control points: where known towns sit on the picture). `npm run maps` crops and resizes
  the image to `public/maps/<id>.webp` and fits the source map's places onto it (least squares plus a smooth correction that makes each
  control point exact). Currently: Hoenn (ORAS), Kanto (Let's Go), Sinnoh (BDSP), Unova (B2W2), Kalos and Paldea.
- **Drawn schematics** (`src/data/maps/*.json`, rendered by `src/components/pokedex/SchematicMap.tsx`) for the rest.

A clean, full-size image with no UI or icons burned in makes a much better map than a screenshot: drop it in `src-assets/maps/`,
copy a `.json` next to an existing one, and pick control points with the grid in the scratch tool (any image viewer with pixel coordinates works).
