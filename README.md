# Pokémon Team Builder — Champions + Gen 1–9

A Pokémon team builder and database built with Vite, React 19, TypeScript, Tailwind v4 and Zustand.

- **Pokémon Champions** formats: Lv 50, 31 IVs, and the Stat Point system (66 total SP, 32 max per stat).
- **Gen 1–9** formats, one per generation, each following that generation's games: its Pokédex, movepools, move data, type chart and stat system (see [Gen 1–9](#gen-19)).
- Formats for the rest of the main series: **Let's Go, Pikachu!/Eevee!**, **Brilliant Diamond/Shining Pearl**, **Legends: Arceus** and **Legends: Z-A** (see [Let's Go, BDSP and Legends](#games)).
- A **Pokédex** for every generation and game, with entries, learnsets and an **Area** map showing where each Pokémon lives, drawn the way that game drew it (see [Pokédex](#pokédex)).

```bash
npm install
npm run dev           # http://localhost:5173
npm test              # vitest: stat engines, codecs, validation
npm run typecheck
npm run e2e           # browser smoke tests (Playwright) against the production build; see docs/E2E.md
npm run build         # static site in dist/
npm run build:single  # one self-contained index.html (works offline)
npm run data          # regenerate src/data/generated/*.json (Showdown data + regulation files + Gen 1–9 datasets)
npm run pokedex       # Pokédex entries + wild encounters per book (PokeAPI CSVs + PKHeX encounter tables)
npm run maps          # Area maps: in-game maps from the pret disassemblies + src/data/maps/*.json schematics
npm run atlas         # Atlas databases per game (locations, items, NPCs, shops, every trainer's team) from the pret decompilations; needs `npm run data`, `pokedex` and `maps` first
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
scripts/build-games.ts       Let's Go / BDSP / Legends: Arceus / Legends: Z-A datasets from Showdown's game mods
scripts/build-pokedex.ts     Pokédex entries, regional numbers, wild encounters (PokeAPI CSVs + PKHeX)
scripts/pkhex-encounters.ts  Reads PKHeX's wild-encounter tables (BDSP, Legends, SV, ORAS, SM/USUM)
scripts/sources.ts           Pinned Showdown / PKHeX checkouts the build scripts read from
scripts/build-atlas.ts       Atlas driver: `npm run atlas [-- game]` writes atlas-<game>.json + docs/data-gaps/<game>.md
scripts/atlas/               one builder per engine: gen1 (Red/Blue/Yellow), gen2 (Gold/Silver/Crystal), gba (Ruby/Emerald/FireRed), platinum
scripts/build-maps.ts        Area maps: renders the Gen 1–4 in-game maps from pret, validates the schematics, writes docs/MAP_COVERAGE.md
src/
  domain/                    Framework-free core (100% unit-testable)
    types.ts                 Pokemon, Move, Ability, Item, Nature, StatPoints, EVSpread, IVSpread,
                             DVSpread, StatSystem (union), FormatRules, PokemonSet, Team, Dataset
    formats.ts               Format registry (Champions regulations + one format per generation)
    generations.ts           Generation symbols, and what each generation's battles had (mechanics())
    games.ts                 Let's Go / BDSP / Legends rules (formatMechanics()) and the Pokédex books
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
    maps/*.json              Hand-placed schematic region maps (Unova → Paldea); edit these, not maps.json
    pokedex.ts               Lazy loaders for the Pokédex files
  store/teamStore.ts         Zustand store (teams, active slot, theme), persisted to localStorage
  components/
    editor/StatDistributor   Champions SP calculator (sliders, numeric input, +/− alignment, presets, speed target)
    editor/SetEditor         Species / item / ability / nature / Tera / moves (learnset-filtered)
    team/TeamSlots           6-slot roster with drag-and-drop (dnd-kit)
    analysis/                Validation panel, defensive type matrix
    io/                      Import/export dialog, saved-teams dialog
    atlas/                   Pokénav tab: interactive game maps, location panel, trainer detail, item database, trainer index, progress
    pokedex/                 Pokédex list + entry (Info / Moves / Area) and the region map renderer
```

### Stat formulas

| System | HP | Other stats |
|---|---|---|
| Champions (Lv 50, 31 IV) | `Base + SP + 75` | `⌊(Base + SP + 20) × nature⌋` |
| Gen 3–9 | `⌊(2B + IV + ⌊EV/4⌋)·L/100⌋ + L + 10` | `⌊(⌊(2B + IV + ⌊EV/4⌋)·L/100⌋ + 5) × nature⌋` |
| Gen 1–2 | `⌊((B+DV)·2 + ⌊⌈√StatExp⌉/4⌋)·L/100⌋ + L + 10` | same, `+ 5` |
| Let's Go | `AV + ⌊(2B + IV)·L/100⌋ + L + 10` | `AV + ⌊friendship% × ⌊(⌊(2B + IV)·L/100⌋ + 5) × nature⌋ / 100⌋` (friendship% 100–110) |
| Legends: Arceus | `bonus + ⌊(L/100 + 1)·B + L⌋` | `bonus + ⌊⌊(L/50 + 1)·B / 1.5⌋ × nature⌋`, bonus = `round((√B × M[EL] + L) / 2.5)` |

The Let's Go and Legends: Arceus formulas are ported from PKHeX (`PB7.cs`, `PA8.cs`), including the Legends: Arceus float arithmetic.

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

### Meta tab

The Meta tab lists each Champions regulation's most-used Pokémon with their common items, moves, abilities, spreads and teammates.
The numbers are [Smogon's monthly usage statistics](https://www.smogon.com/stats/) (rated Pokémon Showdown ladder battles), built into the app by `npm run meta` and kept current by a weekly GitHub Action.
A regulation without published statistics falls back to your own logged matches. See [`docs/UPDATING_META.md`](docs/UPDATING_META.md).

### Cloud sync

**Settings → Sync → Sync with my account** (web and phone app, opt-in) keeps your teams (with folders and variations) and your match log the same on every device you sign in on, through the Cloudflare deployment that already hosts the app. It is offline-first (localStorage stays the source of truth), syncs on start, on focus, a few seconds after a change and on "Sync now", and merges with what is already on a new device instead of wiping it. Last write wins per document; when two devices changed the same team the older change is kept as a variation named "Conflict copy (device, date)"; an edit beats a delete unless the delete is clearly later.
`worker/` is the Worker behind `/api/sync` (Cloudflare Access JWT verification, D1 storage, zod-validated and sanitised payloads), `src/domain/sync.ts` the merge rules and `src/sync/` the client. One-time setup (D1, migration, Access variables), backups, turning it off and the desktop options are in [`docs/SYNC.md`](docs/SYNC.md). The desktop app and the single-file build don't sync.

### Sharing and comparing teams

With sync on you can **share a team folder** (a team and its variations) with another e-mail as *can view* or *can edit* (Teams → share button). They see it under **Teams → Shared with me**; view-only teams are read-only with a **Make my own copy** button, editable ones merge like your own (conflict copies included). **Share my matches** (Settings → Sync) lets a friend see your match log read-only in a separate **Whose matches** picker, and in the Meta tab's own-match fallback; nothing is mixed into your stats unless you pick **Both of us**. Set a display name in Settings; after a sync a small toast says when someone else changed a team you can see. **More → Compare teams** puts any two teams (mine, shared, or two variations) side by side: set-by-set diff, type matrices, Speed tiers and threat summaries. Access rules, limits and setup (one more migration) are in [`docs/SYNC.md`](docs/SYNC.md).

### Regulation changes

When a regulation changes, the app shows what it does. **More → Regulation diff** (`#regdiff`) compares any two Champions regulations: Pokémon, Megas, items, moves and abilities added or removed (with sprites and item icons), species patches as before → after (typing, stats, abilities) and the unconfirmed entries, labelled as such. Saved teams get a badge when their regulation isn't the live one and a "N problems in Reg M-D" chip when something of theirs isn't legal there; the Saved teams dialog gathers them under "3 of your teams have problems in Reg M-D". In the builder, the regulation banner shows the impact before "Move team to <live>" (what breaks, what changes, what is new, with the final-stat effect of a patched Pokémon) and **Copy to <regulation>** adds a variation with the illegal parts removed and a checklist of what to fix; the original is never modified. A next regulation with a start date counts down in the banner.
`src/domain/regulationImpact.ts` (pure) computes legality from the Dex and from `validateTeam` for the target format, so it can't disagree with the validator, and works for Showdown-based sets as well as delta ones; only the patches and unconfirmed notes come from `src/data/generated/regulation-changes.json`, which `npm run data` builds from the delta files.

### Bring planner

**Plan vs this team** (on a logged match with a saved team picked, and in the Matchup tab) suggests which four of your six to bring and which two to lead, in doubles (bring 4, lead 2; singles 3 and 1), with the best three plans, each with two to four plain reasons and a main risk ("Nothing in this four outspeeds Dragapult outside Tailwind"). It is a suggestion, not a prediction.
Their six can be added as species, pasted as Showdown text, loaded from a logged match's Team Preview (what the log saw overrides) or taken from a saved enemy team. Each of their Pokémon uses its most-used set (`metaSets`) unless more is known; known item, ability and moves override it field by field, and a full pasted or saved set is used as it is.
`src/domain/bringPlanner.ts` (pure) scores all C(6,4) = 15 fours × 6 lead pairs with the Threat report's damage and speed numbers: pressure and risk against what they probably bring (their four most dangerous to your team), tempo, type coverage, speed control (Tailwind, Trick Room, Icy Wind, Electroweb, and whether it flips the matchup) and support (Fake Out, Intimidate, redirection, Wide Guard). Only one Pokémon can Mega Evolve per battle, so two Mega Stone holders may both come but only one gets its Mega stats in any plan. All weights are constants in one place (`WEIGHTS`). **Use this plan** saves what you bring and lead onto the match (or a new one). Champions only; other formats get an explanation.

### Match log: brought, led and analytics

Besides the result and the opponent's Team Preview, a match can record **what each side brought and led**: tap a Pokémon's sprite to cycle not brought → brought → lead (doubles bring 4 / lead 2, singles 3 / 1, from the match's regulation), for your side and for the opponent's revealed six. It's all optional; a match with only a result is still valid. Saved-team Pokémon are stored by uid, run-and-gun ones by species; the save format is v3 (`ptb:matches:v1`, a v2 log loads unchanged), and the CSV export gains the four columns.
The analytics (`src/domain/matchStats.ts`, pure and tested) sit under the log with filters for regulation, category, date range and team or folder of variations: win rate **by my lead**, **by the four I brought** and **by team variation**; per opponent Pokémon the record when it was on their team, when they brought it and when they led it; a **nemesis** list (the five worst, among those faced at least five times) linking to the Damage Calc, Speed tiers and Threat report on that Pokémon; a **weekly win rate** chart per regulation; and an **archetype vs archetype** grid.
Every rate carries a Wilson 95% range, and a record from fewer than 5 games is greyed and shown without a percentage, so a 1–0 never reads as 100%. Lead and brought groups are by species, so variations of one team merge.

### Stat Point optimiser

The **Optimise** button in the stat calculator (Champions Stat Points and Gen 3–9 EVs) finds the cheapest spread for goals: **survive** a move (every roll, 15 of 16, or at least half; optionally on a crit), **outspeed** a Speed (or, for Trick Room, stay under it), or **knock out** a Pokémon in one or two hits, in priority order, with the leftover points put in one stat or "max HP, then split evenly".
The other Pokémon comes from the most-used sets, your saved teams, or any species (prefilled with its meta set where there is one). Every number comes from the Damage Calc (`src/domain/optimizer.ts`), and because each goal is monotonic in its stats the search is exact without trying every combination: for each HP value the least Def/SpD that passes, found with a two-pointer walk, and a binary search for Atk/SpA/Spe. It can keep your nature or suggest one (never lowering a stat a goal needs). A goal that can't be met says how short it falls ("short by 3% even at max HP and SpD: consider Assault Vest", "needs 4 more SP than you have"); when the points run out the later goal is the one dropped.
The result sits next to your current spread with ✓/✗ per goal; **Apply** writes it (undoable). Speed tiers' "Outspeed this" and the Threat report's cells ("Survive this…") open it with the goal filled in.

### Threat report

**More → Threat report** (`#threats`, with a "Top threats" line in Team check) runs the Damage Calc for your whole team against the most-used Champions sets, in both directions, on one screen.
Each threat is a meta set (`src/domain/metaSets.ts`: the most common ability, item, spread and nature, and the top four moves, never four status moves; anything the format doesn't allow is dropped and reported). Every cell shows your best move and its best move as OHKO / possible OHKO / 2HKO / 3HKO+ with the damage range, and who moves first; Mega Stone holders are read at their worse forme for you and their better one for the threat. Plain-language summaries rank the worst threats first ("Kingambit OHKOs 3 of your Pokémon and none of yours OHKO it back", "Nothing on your team outspeeds and 2HKOs Flutter Mane").
The field (Doubles by default, weather, terrain, Trick Room) and the number of threats (10/20/30) change everything at once. The grid uses a blue-to-orange scale with ✓/✗/~ and words in every cell, and becomes one card per threat on phones; tapping a cell opens the Damage Calc pre-filled with that attacker, defender and field.
The engine (`src/domain/threats.ts`) is pure; the page runs it in a Web Worker (`src/workers/`) with memoised cells and streams rows in as they finish, so it doesn't freeze a phone (the single-file build runs it on the main thread in small slices instead). It uses the same newest-published-regulation fallback and data-age notice as Speed tiers. Other formats show an explanation instead.

### Speed tiers

**More → Speed tiers** (`#speed`, also linked from Team check) is a ladder of the most-used Champions Pokémon's likely Speeds with your team on the same scale, fastest first.
Each meta Pokémon is built from its published spreads (spreads with the same final Speed merge), its most common ability and item; a Mega Stone holder also gets its Mega forme's Speed, and a Choice Scarf row appears when at least 10% of its sets hold one.
Every number comes from the Damage Calc's own speed (`calcSpeed`), so the two can't disagree. Toggle Tailwind, −1/+1/+2, paralysis and (for your side) Choice Scarf per side, plus weather, terrain and Trick Room, which flips the ladder.
Tap a meta row for **Outspeed this**: the Stat Points (and nature, if needed) one of your Pokémon needs to beat it in that scenario, with an undoable Apply.
The numbers come from the newest regulation with published usage, and the page says which regulation, month and age (when the live regulation has none yet, it says so and uses the previous one). Other formats show an explanation instead.

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

<a id="games"></a>
### Let's Go, BDSP and Legends

The rest of the main series has one format each. Every game has its own dataset, built from Pokémon Showdown's mod for it (`gen7letsgo`, `gen8bdsp`, `gen8legends`, `gen9legends`), with that game's roster, movepools and Mega Evolutions:

| Game | Stats | What's different |
|---|---|---|
| Let's Go, Pikachu! / Eevee! | AVs 0–200 per stat, IVs, friendship (+10% at 255) | the 151 + Meltan/Melmetal, Alolan forms, partner Pikachu/Eevee and their moves; Megas; no abilities; the item slot is the Mega Stone in the Bag |
| Brilliant Diamond / Shining Pearl | IVs / EVs | the Sinnoh remakes with Sword/Shield mechanics and no Dynamax |
| Legends: Arceus | Effort Levels 0–10 | Hisui's roster and moves (Stone Axe…); no abilities or held items |
| Legends: Z-A (+ Mega Dimension) | IVs / EVs | Lumiose's roster and new Megas; held items from PKHeX's Z-A item pouches; no abilities |

The damage calculator uses Gen 7 mechanics for Let's Go, with the game's own AV and friendship stats. Legends: Arceus (Agile/Strong Styles) and Legends: Z-A (real-time battles) aren't turn-based Showdown mechanics, so for those two the calculator and in-battle details explain that instead of showing numbers that would be wrong.
In both Legends games, move power and accuracy are Showdown's Sword/Shield and Scarlet/Violet values, because Showdown has no data for those games' own move changes.

### Pokénav

The **Pokénav** tab (`#atlas`, formerly Atlas) is a game database built around the game's own map. Every main-series game with a public decompilation is covered: Red / Blue / Yellow, Gold / Silver / Crystal, Ruby / Sapphire / Emerald, FireRed / LeafGreen, HeartGold / SoulSilver, Diamond / Pearl and Platinum (from [pret](https://github.com/pret)'s Red, Yellow, Gold, Crystal, Ruby, Emerald, FireRed, HeartGold and Platinum decompilations; HeartGold's scripted counters (apricorn, Game Corner) aren't read, see `docs/data-gaps/heartgold.md`). Diamond / Pearl's scripts are compiled binaries, so it has the map, places, every trainer's team, gyms and Pokémon Centers but no items, NPCs or shop stock (`docs/data-gaps/diamond.md`); Generation 5 onward has no decompilation to read, so those games need a different source.

- **Map:** the Sinnoh Town Map rendered from [pret/pokeplatinum](https://github.com/pret/pokeplatinum) (whole-number upscale, pixel-perfect), with the game's red city, blue landmark and teal special markers. Every place is a focusable shape: hover for a preview, click / Enter / tap to open, arrow keys move between places. Filters (has Gym / Mart / Pokémon Center, has item, Pokémon appears here, trainer uses move, free text) make the matches glow.
- **Location panel** (side panel; bottom sheet on phones): Overview (Gym leader, badge and level cap, Poké Mart stock with prices and badge tiers, connections, obstacles), Items (every visible, hidden, gift and TM spot with tile coordinates), NPCs (dialogue, gifts, trades), Wild Pokémon (from the Pokédex tables, linked to the Pokédex), Trainers and Notes.
- **Trainers:** all 927 trainers with full teams: level, item, moves, ability, nature and IVs as the game computes them, rematch and starter-dependent versions, the team's defensive and offensive matrices, **Load into Builder** (through the Showdown importer, in the game's Gen format) and **Calc as attacker / defender**.
- **Items**, **Trainers** and **Progress** pages: item database with every place to get an item, trainer index searchable by name, class, location, Pokémon or move, and a progress tracker (visited / collected / beaten, saved in this browser).

Data is generated by `npm run atlas` from the decompilation and never edited by hand. Anything the source doesn't settle is listed as unverified; [`docs/data-gaps/`](docs/data-gaps) reports what was found against what the source holds, per game.

Generation 5 onward (Black / White … Scarlet / Violet, Legends: Arceus and Z-A) has no decompilation to read, so those games are **encounters only**: a searchable list of places with every wild, static, gift and trade Pokémon, built from the Pokédex data by `scripts/atlas/encounters.ts`. No map, items, NPCs, shops or trainer teams ([`docs/atlas-sources.md`](docs/atlas-sources.md)).

### Pokédex

The **Pokédex** tab (`#dex`) has a book for every generation and for Let's Go, BDSP, Legends: Arceus and Legends: Z-A. Each book lists the species its games had, numbered by National or regional Pokédex (Kanto, Johto, Sinnoh (Pt), Coastal Kalos, Galar, Hisui, Lumiose City…). Each entry has three tabs:

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
| Let's Go, Pikachu! / Eevee! | FireRed/LeafGreen's Kanto map |
| Diamond / Pearl / Platinum, Brilliant Diamond / Shining Pearl | Platinum's Town Map with every hidden location revealed and glowing areas on its 7×7 blocks ([pret/pokeplatinum](https://github.com/pret/pokeplatinum)); BDSP's Grand Underground runs under the whole region, so it's listed rather than marked |
| Unova, Kalos, Alola, Galar (+ Isle of Armor, Crown Tundra), Hisui, Paldea, Kitakami, Blueberry Academy Terarium, Lumiose City | schematic maps with hand-placed locations (`src/data/maps/*.json`, Lumiose generated), clearly labelled as schematics in the app, since these games have no disassembled map data |

For the Gen 1–4 maps, each location sits exactly where the game put it; the build script reads the coordinates from the disassemblies (pinned in `scripts/sources.ts`) and writes lossless WebP images plus [`docs/MAP_COVERAGE.md`](docs/MAP_COVERAGE.md).
The map zooms (buttons, pinch, ctrl/⌘ + wheel, double-click) and pans by dragging; tapping a marked place highlights it in the list below, and picking a location in the list highlights it on the map.
HeartGold/SoulSilver and ORAS locations the older map doesn't have, such as Routes 47–48 or Sea Mauville, are placed next to their nearest neighbour.
In Legends: Arceus and Z-A, whole areas (Obsidian Fieldlands, a Lumiose district) are drawn as dashed outlines that light up as outlines, so the places inside them stay readable.
A test checks that every wild location of every book is on its game's map, apart from places with no fixed spot: roaming Pokémon, event islands, Mirage spots, Ultra Space and the Grand Underground.

Data: Pokédex text, regional numbers and most encounters come from [PokeAPI](https://github.com/PokeAPI/pokeapi)'s CSV tables.
Wild encounters for BDSP, Legends: Arceus, Scarlet/Violet (+ Kitakami and Blueberry), Legends: Z-A, ORAS and SM/USUM come from [PKHeX](https://github.com/kwsch/PKHeX)'s encounter tables instead, because PokeAPI has none for these games or only part of them. PokeAPI's gifts, static encounters and Island Scan entries are kept. PKHeX lists who appears where and at which levels, and flags Alphas, but it has no encounter rates.
PokeAPI has Pokédex entries for only some species in the newest games (e.g. 120 in Scarlet/Violet, none in BDSP or Z-A). The rest show the latest earlier game's entry, labelled with that game.

### Replica Team codes

Replica codes are issued by the game's servers and point to a team stored there, so this app can't generate them.
The app checks and normalises a code you paste (10 alphanumerics), stores it on the team and prints it in the team list.
To share a team between builders, use the self-contained **share code** (`PTB1.…`) instead.

## Roadmap

- **Gen 1–9:** level caps and Nuzlocke planning; gift/static encounters for the PKHeX-sourced games; the Legends games' own move data once Showdown has it.
- **Module 1:** full ChampDex explorer (radar chart, learnset filters).
- **Module 3:** offensive coverage and speed-tier chart against format threats (Tailwind / Trick Room).
- **Persistence:** IndexedDB / Supabase sync behind the same store interface.
