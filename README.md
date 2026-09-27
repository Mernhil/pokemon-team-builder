# Pokémon Team Builder — Champions + Gen 1–9

A Pokémon team builder and database built with Vite, React 19, TypeScript, Tailwind v4 and Zustand.

- **Pokémon Champions** formats: Lv 50, 31 IVs, and the Stat Point system (66 total SP, 32 max per stat).
- **Gen 1–9** formats, one per generation, each following that generation's games: its Pokédex, movepools, move data, type chart and stat system (see [Gen 1–9](#gen-19)).
- A **Pokédex** for every generation, with entries, learnsets and an **Area** map showing where each Pokémon lives, drawn the way that generation's games drew it (see [Pokédex](#pokédex)).

```bash
npm install
npm run dev           # http://localhost:5173
npm test              # vitest: stat engines, codecs, validation
npm run typecheck
npm run build         # static site in dist/
npm run build:single  # one self-contained index.html (works offline)
npm run data          # regenerate src/data/generated/*.json (Showdown data + regulation files + Gen 1–9 datasets)
npm run pokedex       # Pokédex entries + wild encounters per generation (PokeAPI CSVs, cached in .cache/pokeapi)
npm run maps          # Area maps: in-game maps from the pret disassemblies + src/data/maps/*.json schematics
npm run sprites       # rebuild sprite atlases in public/sprites/ (PokeAPI)
npm run reg:status    # regulation calendar: live set, end date, announced sets
npm run build:artifact  # single-file build for the hosted claude.ai app
npm run icons         # re-render the home-screen icons in public/icons/ from favicon.svg
```

**On a phone:** every push to the default branch is deployed (privately, behind a login) as an installable, offline-capable web app that updates itself — see [docs/IPHONE_APP.md](docs/IPHONE_APP.md).

## Architecture

```
scripts/build-data.ts        Build-time pipeline: @pkmn/dex + @pkmn/mods → compact JSON per dataset
scripts/build-gens.ts        Gen 1–9 datasets (Dex.forGen(n)): species, move data, movepools, items, type chart
scripts/build-pokedex.ts     Pokédex entries, regional numbers, wild encounters (PokeAPI CSVs)
scripts/build-maps.ts        Area maps: renders the Gen 1–3 in-game maps from pret, validates the schematics
src/
  domain/                    Framework-free core (100% unit-testable)
    types.ts                 Pokemon, Move, Ability, Item, Nature, StatPoints, EVSpread, IVSpread,
                             DVSpread, StatSystem (union), FormatRules, PokemonSet, Team, Dataset
    formats.ts               Format registry (Champions regulations + one format per generation)
    generations.ts           Generation symbols, and what each generation's battles had (mechanics())
    pokedex.ts               Pokédex file shapes, evolution trees, learn methods, encounter decoding
    stats.ts                 Champions SP, Gen 3–9 EV/IV and Gen 1–2 DV/Stat Exp formulas + budget helpers
    validation.ts            Team validator: Species/Item Clause, SP cap, learnset & regulation legality…
    codecs.ts                Showdown import/export, Champions team list, share code, JSON backup, Replica code utils
    team.ts                  Factories (createTeam, createSet, cloneTeam)
  data/
    dex.ts                   Dex query layer (lookup, legality, learnsets, type effectiveness, search) + lazy dataset loader
    useDex.ts                React hook for loading a dataset
    generated/champions.json 379 species (incl. Megas), 511 moves, 165 items, 216 abilities, natures, type chart
    generated/gen<N>.json    Gen 1–9 datasets; gen<N>-learn.json learn methods; pokedex-gen<N>.json; maps.json
    maps/*.json              Hand-placed schematic region maps (Sinnoh → Galar); edit these, not maps.json
    pokedex.ts               Lazy loaders for the Pokédex files
  store/teamStore.ts         Zustand store (teams, active slot, theme), persisted to localStorage
  components/
    editor/StatDistributor   Champions SP calculator (sliders, numeric input, +/− alignment, presets, speed target)
    editor/SetEditor         Species / item / ability / nature / Tera / moves (learnset-filtered)
    team/TeamSlots           6-slot roster with drag-and-drop (dnd-kit)
    analysis/                Validation panel, defensive type matrix
    io/                      Import/export dialog, saved-teams dialog
    pokedex/                 Pokédex list + entry (Info / Moves / Area) and the region map renderer
```

### Stat formulas

| System | HP | Other stats |
|---|---|---|
| Champions (Lv 50, 31 IV) | `Base + SP + 75` | `⌊(Base + SP + 20) × nature⌋` |
| Gen 3–9 | `⌊(2B + IV + ⌊EV/4⌋)·L/100⌋ + L + 10` | `⌊(⌊(2B + IV + ⌊EV/4⌋)·L/100⌋ + 5) × nature⌋` |
| Gen 1–2 | `⌊((B+DV)·2 + ⌊⌈√StatExp⌉/4⌋)·L/100⌋ + L + 10` | same, `+ 5` |

A test checks the Champions engine against Pokémon Showdown's own `statModify` for every legal species across several natures.

### Sprites

Every sprite set is one WebP atlas plus a JSON index in `public/sprites/`. They're built by `scripts/build-sprites.ts` from the [PokeAPI sprites](https://github.com/PokeAPI/sprites) repo.
Each format picks its set with `FormatRules.spriteSet`:

| Set | Source | Pokémon |
|---|---|---|
| `champions` | Pokémon Champions in-game renders | the Champions roster, Megas included |
| `gen1` | Red / Blue | #1–151 |
| `gen2` | Crystal | #1–251 |
| `gen3` | Emerald | #1–386 |
| `gen4` | Platinum | #1–493 |
| `gen5` | Black / White | #1–649 |
| `gen6` | X / Y | #1–721 |
| `gen7`, `gen8` | Pokémon HOME renders (the Gen 7–8 games have no front sprites in PokeAPI) | #1–809 / #1–905 |
| `gen9` | Scarlet / Violet | #1–1025 |

The Pokédex and Gen N formats use that generation's set. The editor's **Across generations** strip shows a Pokémon in every style it appears in.

### Generation symbols

`src/domain/generations.ts` gives each generation a numeral, a region and a colour taken from its flagship games.
`GenBadge` draws them on species rows, team slots and the editor.
The species picker filters by generation.

### Data and regulations

Each regulation is a file in `src/data/regulations/`. There are two kinds:

- **Showdown-based** (`"base": {"showdownMod": "champions"}`): legality comes from that Showdown mod.
- **Delta** (`"base": {"extends": "champions-reg-mb"}`): adds or removes species, items and moves, patches abilities, and can define Pokémon Showdown doesn't know yet. **Reg M-C** is built this way from official announcements.

Champions formats are generated from these files, and the app switches to the live one by date.
`schedule.json` holds announced sets that don't have data yet.

A weekly scheduled task follows [`docs/UPDATING_REGULATIONS.md`](docs/UPDATING_REGULATIONS.md). Each run researches new regulations, writes or updates these files, rebuilds, tests, commits and republishes the app.

### Advanced details and damage calculator

Each Pokémon in the builder has an **Advanced details** panel for "what are my stats under…" questions. You can set:

- **Field:** singles or doubles, weather, terrain, Trick Room, Gravity
- **Side:** Tailwind, Reflect, Light Screen, Aurora Veil, Helping Hand, Friend Guard
- **The Pokémon:** status, current HP, Mega and Tera toggles, stat stages (with presets such as Intimidated, Swords Dance and Icy Wind), and the ability switches (Unburden, Booster Energy, Flash Fire…)

It then shows:

- final stats, with every modifier listed (Chlorophyll, Swift Swim, Choice Scarf, paralysis, Assault Vest, snow and sand boosts…)
- physical and special bulk after screens
- the power of each move (Sharpness, Technician, Tough Claws, -ate abilities, STAB, Tera, weather, terrain, crits…)

The code is in `src/domain/battle/effective.ts`. It uses the games' 4096-based modifier chaining, and a test checks that its Speed numbers match the damage calculator exactly.

The **Damage Calc** tab (`#calc`) is built from the same parts: an attacker and a defender panel, loadable from your team in one click, plus field controls.
It shows damage in both directions (range, % bar, KO chance, all 16 rolls) and who moves first.
The engine is [`@smogon/calc`](https://github.com/smogon/damage-calc), which has a dedicated Pokémon Champions mechanics module (`src/domain/battle/damage.ts` adapts to it).
Our regulation data stays in charge of each Pokémon's typing and stats, so Megas added from announcements, such as the Z Megas, calculate correctly.

<a id="gen-19"></a>
### Gen 1–9

Pick a **Gen N** format in the header to build a team for that generation's games:

| Gen | Games | Stat system | What's different |
|---|---|---|---|
| 1 | Red · Blue · Yellow | DVs 0–15, Stat Exp | one Special stat; no abilities, natures or held items; Gen 1 type chart and move data |
| 2 | Gold · Silver · Crystal | DVs, Stat Exp | held items; Sp. Atk/Sp. Def share one Special DV and Stat Exp |
| 3 | Ruby · Sapphire · Emerald · FireRed · LeafGreen | IVs / EVs | abilities, natures; physical/special still decided by type |
| 4–5 | DPPt · HGSS · BW · B2W2 | IVs / EVs | per-move physical/special split; Hidden Abilities from Gen 5 |
| 6–7 | XY · ORAS · SM · USUM | IVs / EVs | Fairy type, Mega Evolution |
| 8 | Sword · Shield (+ DLC) | IVs / EVs | only the Pokémon and moves Sword/Shield had |
| 9 | Scarlet · Violet (+ DLC) | IVs / EVs | Terastallization; only what Scarlet/Violet had |

Every dataset comes from Pokémon Showdown's own generation data (`Dex.forGen(n)`), so move power, accuracy, PP, type, category and effect text are as they were in that generation. For example, Gen 1 Bite is a Normal-type move, Thunderbolt is 95 power until Gen 6, and Curse is `???`-type in Gen 2–4.
Movepools only contain what that generation's games taught: level-up, TM/HM, tutor, egg and event moves, plus moves learned before evolving. Moves that could only be transferred in from an older game aren't included.
Levels run from 1 to 100. The damage calculator and the Advanced details panel switch to that generation's mechanics, so paralysis quarters Speed before Gen 7, crits do 2× before Gen 6, Gen 3–8 has Hail instead of Snow, and fields that didn't exist yet (terrain, Trick Room, Aurora Veil…) are hidden.
Showdown import/export works both ways, including Gen 1–2 sets, where Showdown writes Stat Exp as EVs and DVs as IVs.

### Pokédex

The **Pokédex** tab (`#dex`) covers every generation. For each one it lists the species its games had, numbered by National or regional Pokédex (Kanto, Johto, Sinnoh (Pt), Coastal Kalos, Galar, Isle of Armor…). Each entry has three tabs:

- **Info:** Pokédex entries from each of the generation's games, category, height, weight, gender, egg groups, base stats, abilities, type defenses on that generation's chart, the evolution tree and other forms. **Add to team** puts the Pokémon in your team when the team plays that generation.
- **Moves:** the learnset by level-up, TM/HM, tutor, egg and event moves, plus moves learned via pre-evolutions, with that generation's move data.
- **Area:** pick a game to see where the Pokémon lives on its region map, then every location's floor, method (grass, Surf, Old/Good/Super Rod, Headbutt, Rock Smash, Swarm…), levels, encounter rate and conditions (time of day, season, dual-slot, Poké Radar…).

Area maps mark locations the way each game's Pokédex did:

| Games | Map |
|---|---|
| Red / Blue / Yellow | the Red/Blue town map with the blinking nest icon ([pret/pokered](https://github.com/pret/pokered)) |
| Gold / Silver / Crystal, HeartGold / SoulSilver | Crystal's Pokégear Johto and Kanto maps with its nest icon ([pret/pokecrystal](https://github.com/pret/pokecrystal)) |
| Ruby / Sapphire / Emerald, Omega Ruby / Alpha Sapphire | Emerald's Pokédex area map with glowing areas ([pret/pokeemerald](https://github.com/pret/pokeemerald)) |
| FireRed / LeafGreen | FireRed/LeafGreen's Kanto and Sevii Islands maps ([pret/pokefirered](https://github.com/pret/pokefirered)) |
| Sinnoh, Unova, Kalos, Alola, Galar (+ Isle of Armor, Crown Tundra) | schematic maps with hand-placed locations (`src/data/maps/*.json`), since these games have no disassembled map data |

For the Gen 1–3 maps, each location sits exactly where the game put it; the build script reads the coordinates from the disassemblies.
HeartGold/SoulSilver and ORAS locations the older map doesn't have, such as Routes 47–48 or Sea Mauville, are placed next to their nearest neighbour.
A test checks that every wild location in Gens 1–8 is on its game's map, apart from places with no fixed spot: roaming Pokémon, event islands, Mirage spots and Ultra Space.

Data: Pokédex text, regional numbers and encounters come from [PokeAPI](https://github.com/PokeAPI/pokeapi)'s CSV tables.
PokeAPI has no wild-encounter tables for Scarlet/Violet, so the Gen 9 Area tab says so. PokeAPI also has Scarlet/Violet Pokédex entries for only 120 species, so the rest show the latest earlier game's entry, labelled with that game.

### Replica Team codes

Replica codes are issued by the game's servers and point to a team stored there, so this app can't generate them.
The app checks and normalises a code you paste (10 alphanumerics), stores it on the team and prints it in the team list.
To share a team between builders, use the self-contained **share code** (`PTB1.…`) instead.

## Roadmap

- **Gen 1–9:** level caps and Nuzlocke planning; Scarlet/Violet Area maps once an encounter dataset exists; Let's Go, BDSP and Legends games.
- **Module 1:** full ChampDex explorer (radar chart, learnset filters).
- **Module 3:** offensive coverage and speed-tier chart against format threats (Tailwind / Trick Room).
- **Persistence:** IndexedDB / Supabase sync behind the same store interface.
