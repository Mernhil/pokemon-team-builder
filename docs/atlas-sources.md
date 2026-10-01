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
