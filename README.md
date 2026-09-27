# Pokémon Team Builder — Champions-first

A Pokémon team builder and database built with Vite, React 19, TypeScript, Tailwind v4 and Zustand.
Phase 1 covers the **Pokémon Champions** format: Lv 50, 31 IVs, and the Stat Point system (66 total SP, 32 max per stat).

```bash
npm install
npm run dev           # http://localhost:5173
npm test              # vitest: stat engines, codecs, validation
npm run typecheck
npm run build         # static site in dist/
npm run build:single  # one self-contained index.html (works offline)
npm run data          # regenerate src/data/generated/*.json (Showdown data + regulation files)
npm run sprites       # rebuild sprite atlases in public/sprites/ (PokeAPI)
npm run reg:status    # regulation calendar: live set, end date, announced sets
npm run build:artifact  # single-file build for the hosted claude.ai app
npm run icons         # re-render the home-screen icons in public/icons/ from favicon.svg
```

**On a phone:** every push to the default branch is deployed as an installable, offline-capable web app that updates itself — see [docs/IPHONE_APP.md](docs/IPHONE_APP.md).

## Architecture

```
scripts/build-data.ts        Build-time pipeline: @pkmn/dex + @pkmn/mods → compact JSON per dataset
src/
  domain/                    Framework-free core (100% unit-testable)
    types.ts                 Pokemon, Move, Ability, Item, Nature, StatPoints, EVSpread, IVSpread,
                             DVSpread, StatSystem (union), FormatRules, PokemonSet, Team, Dataset
    formats.ts               Format registry (Champions Reg M-B / M-A live; Gen 9 / Gen 4 / Gen 2 declared for Phase 2)
    stats.ts                 Champions SP, Gen 3–9 EV/IV and Gen 1–2 DV/Stat Exp formulas + budget helpers
    validation.ts            Team validator: Species/Item Clause, SP cap, learnset & regulation legality…
    codecs.ts                Showdown import/export, Champions team list, share code, JSON backup, Replica code utils
    team.ts                  Factories (createTeam, createSet, cloneTeam)
  data/
    dex.ts                   Dex query layer (lookup, legality, learnsets, type effectiveness, search) + lazy dataset loader
    useDex.ts                React hook for loading a dataset
    generated/champions.json 347 species (incl. Megas), 496 moves, 147 items, 201 abilities, natures, type chart
  store/teamStore.ts         Zustand store (teams, active slot, theme), persisted to localStorage
  components/
    editor/StatDistributor   Champions SP calculator (sliders, numeric input, +/− alignment, presets, speed target)
    editor/SetEditor         Species / item / ability / nature / Tera / moves (learnset-filtered)
    team/TeamSlots           6-slot roster with drag-and-drop (dnd-kit)
    analysis/                Validation panel, defensive type matrix
    io/                      Import/export dialog, saved-teams dialog
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

The editor's **Across generations** strip shows a Pokémon in every style it appears in.

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

### Replica Team codes

Replica codes are issued by the game's servers and point to a team stored there, so this app can't generate them.
The app checks and normalises a code you paste (10 alphanumerics), stores it on the team and prints it in the team list.
To share a team between builders, use the self-contained **share code** (`PTB1.…`) instead.

## Roadmap

- **Phase 2:** Gen 1–9 datasets (`npm run data` targets), EV/IV and DV/Stat Exp distributor UIs (the engines already exist), level caps, Nuzlocke planning.
- **Module 1:** full ChampDex explorer (radar chart, learnset filters).
- **Module 3:** offensive coverage and speed-tier chart against format threats (Tailwind / Trick Room).
- **Persistence:** IndexedDB / Supabase sync behind the same store interface.
