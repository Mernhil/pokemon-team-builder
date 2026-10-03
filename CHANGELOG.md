# Changelog

Releases before 0.7.0 are described on the GitHub Releases page and in the git history.

## 0.16.0 — 2026-10-03

### New
- **Speed tiers:** a ladder of the most-used Champions Pokémon's likely Speeds (from the published usage spreads, with Mega and Choice Scarf rows) with your team's Pokémon on the same scale and Speed ties called out. Toggle Tailwind, −1/+1/+2, paralysis and Choice Scarf for each side, plus weather, terrain and Trick Room (which flips the order). Tap a meta Pokémon for **Outspeed this**: the Stat Points and nature your selected Pokémon needs to beat it, with an undoable Apply. Under More → Speed tiers, and linked from Team check.

- **Threat report:** your whole team against the most-used Champions sets on one screen: your best move and its best move (OHKO / 2HKO / 3HKO+ with damage ranges), who moves first, and plain-language summaries of the worst threats. Change the field (Doubles/Singles, weather, terrain, Trick Room) or the number of threats and everything updates; tap a cell to open it in the Damage Calc. Under More → Threat report, with a "Top threats" line in Team check.

- **Stat Point optimiser:** an **Optimise** button in the stat calculator finds the cheapest spread for goals like "survive Garchomp's Earthquake", "outspeed Flutter Mane under Tailwind" and "2HKO Kingambit", then puts the leftover points where you say (one stat, or max HP and an even split). It can suggest a nature, tells you how short an unreachable goal falls and what could help, and applies with Undo. Works for Champions Stat Points and Gen 3–9 EVs. Also reachable from Speed tiers ("Optimise…") and the Threat report ("Survive this…").

- **Match log: brought, led and analytics:** record which Pokémon each side brought and led by tapping their sprites (doubles bring 4 / lead 2, singles 3 / 1), all optional. The stats now have filters (regulation, category, dates, team or variation) and show win rate by your lead, by the four you brought and by team variation, the record against each opponent Pokémon (on their team / brought / led), a nemesis list that links to the Damage Calc, Speed tiers and the Threat report, a weekly win-rate chart and an archetype-vs-archetype grid. Every rate shows a 95% range, and fewer than 5 games is greyed out without a percentage. The CSV export has the new columns.

- **Bring planner:** "Plan vs this team" suggests which four to bring and which two to lead against the opponent's six, with the three best plans, plain reasons and the main risk. Add their Pokémon as species, paste their team, load a logged match or use a saved enemy team; unknown sets use the most-used set, and what you know overrides it. Only one Mega per plan. "Use this plan" saves what you bring and lead onto the match. On a logged match and in the Matchup tab.

- **Regulation changes:** a new **Regulation diff** page (More → Regulation diff) compares two regulations: what was added or removed (Pokémon, Megas, items, moves, abilities), species changes as before → after, and unconfirmed entries. Saved teams show a badge when they're not in the live regulation and which of their Pokémon, items or moves aren't legal in it. The regulation banner now shows what moving a team to the live regulation breaks, changes or newly allows, and **Copy to <regulation>** makes a variation with the illegal parts removed and a checklist (the original is untouched). A next regulation with a start date counts down in the banner.

- **Cloud sync (web and phone app):** an opt-in way to keep your teams and match log the same across devices (Settings → Sync). It works offline and syncs when it can; if two devices change the same team, the older change is kept as a "Conflict copy" variation so nothing is lost. It needs a one-time setup on the Cloudflare side (docs/SYNC.md); until then the app behaves as before and Settings says sync isn't set up. The desktop app doesn't sync yet.

- **Sharing and Compare teams (with sync):** share a team folder with another e-mail as *can view* or *can edit*; shared teams appear under Teams → Shared with me with the owner on the tile, view-only ones open read-only with **Make my own copy**, and editable ones merge like your own teams (conflict copies included). **Share my matches** gives a friend a read-only **Whose matches** filter in the Match log and a **Both of us** source for the Meta tab's own-match numbers, never mixed into your stats otherwise. Set a display name in Settings; after a sync a toast says when someone else changed a team you can see. The new **Compare teams** page (More → Compare teams) shows two teams side by side: set-by-set diff (species, item, ability, nature, moves, spreads), both type matrices, Speed against the meta and threat summaries, with variations of one team called out. Needs `migrations/0002_sharing.sql` applied (docs/SYNC.md).

### Fixed
- Light theme: better contrast for the selected game in Pokénav, the map caption, the Losses archetype chip and the small-sample rows in the match stats; the saved-team picker in the match form now has a label.

### Tooling
- Browser smoke tests (Playwright, desktop and iPhone) and a CI workflow run on every pull request; a merged version bump now releases the desktop apps by itself.

## 0.15.0 — 2026-10-02

### New
- **Type matrix suggestions:** the Defensive and Offensive type matrices now call out your team's real problems, worst first — e.g. "Fire is a big problem for your team." When a single type would fix 2 or more problems at once, it's suggested directly, with small type badges — e.g. "A Water-type Pokémon would resist 3 of your weak types" next to Fire/Ice/Steel badges. The full problem list sits behind a collapsed disclosure of compact type-badge chips (coloured and ordered like the matrix cell they're from) so it doesn't crowd the matrix on a phone — except a high-severity problem, which stays visible without a tap.

### Changed
- **Move picker grouped by type:** STAB, Coverage and other attacking moves are now grouped by type (Normal, Fire, Water, …), strongest first within each type, instead of sorted by power across the whole list.
- **Nature picker is easier to spot** in the team editor (pill shape with an accent border and a leaf icon, instead of matching the Held Item / Ability boxes) and its Mint grid's column headers, which had been misaligned (e.g. Modest highlighting under "SpD" instead of "SpA"), are fixed and now colour-coded (green "raises" / red "lowers", with arrows).

## 0.12.0 — 2026-10-02

### New
- **Base + Mega damage calc:** picking a Mega Stone now shows Base and Mega results together by default (a Base / Mega / Both control replaces the old "Mega Evolved" toggle), since only one Pokémon per team can Mega and the stone holder may fight unevolved. Each move shows a labelled line per forme combo in play, and turn order shows both speeds.

### Changed
- **Phone zoom lock:** pinch and double-tap zoom are now disabled for a fixed, native-feeling viewport.
- **Desktop icons regenerate automatically** on `desktop:dev`/`desktop:build`, from `src-assets/logo-source.png`, instead of requiring a manual `npm run icons` step.

## 0.11.2 — 2026-10-02

### Fixed
- **Damage calc:** the Pokémon search now offers every species in the dataset, not only those legal in the team's regulation (Salamence, for instance, was missing on Reg M-A / M-B).
- **Stat sliders on phones:** the coloured line was invisible on iOS Safari (only the thumb showed); it is now drawn on the slider track, with a taller touch area.

## 0.11.1 — 2026-10-01

### New
- **The games' own map artwork** (from screenshots you supplied, in `src-assets/maps/`) for Omega Ruby / Alpha Sapphire (Hoenn), Let's Go (Kanto), Brilliant Diamond / Shining Pearl (Sinnoh), Black / White and Black 2 / White 2 (Unova), X / Y (Kalos) and Scarlet / Violet (Paldea), in Pokénav and the Pokédex Area page. Places are carried over from the existing map of the region and fitted to landmarks on the picture, so positions are approximate. Sun / Moon, Sword / Shield and Legends: Arceus keep the redrawn schematics (no usable image yet).

### Changed
- **Redrawn schematic maps** (Unova, Kalos, Alola, Galar, Hisui, Paldea, Lumiose and the DLC regions) in Pokénav and the Pokédex Area page: an organic coastline with shallow water, textured land, trails for routes, small icons for towns, cities, forests, mountains, caves, ruins, lakes and landmarks, proper place names (they showed raw ids before), and a compass. Still labelled schematic: no decompiled map exists for these games.

## 0.11.0 — 2026-10-01

### New
- **HeartGold / SoulSilver use their own Pokégear map** (Johto and Kanto on one screen, from the pokeheartgold decompilation) in Pokénav and the Pokédex Area page, instead of the Gold / Silver / Crystal map.
- The encounters-only Pokénav games now have a **map behind the list**: the game's own for Omega Ruby / Alpha Sapphire (Hoenn), Let's Go (Kanto) and Brilliant Diamond / Shining Pearl (Sinnoh), and the labelled schematic regions for Unova, Kalos, Alola, Galar (with Isle of Armor and Crown Tundra), Hisui, Paldea (with Kitakami and the Terarium) and Lumiose. Click a place on the map or in the list; filters make matches glow.

## 0.10.0 — 2026-10-01

### New
- **Pokénav for Generation 5 onward (encounters only):** Black / White, Black 2 / White 2, X / Y, Omega Ruby / Alpha Sapphire, Sun / Moon, Ultra Sun / Ultra Moon, Let's Go, Sword / Shield, Brilliant Diamond / Shining Pearl, Legends: Arceus, Scarlet / Violet and Legends: Z-A. A searchable list of the places with every wild, static, gift and trade Pokémon (search by place or by Pokémon) and a visited-places tracker. No map, items, NPCs, shops or trainer teams: no pinned source has them (`docs/atlas-sources.md`).
- A **Team** button on every trainer row opens the trainer's team in the Builder's own roster layout.
- Each game button has a colour icon, and the games are grouped by generation.

### Changed
- The Atlas tab is now called **Pokénav**.

## 0.9.2 — 2026-09-30

### New
- **Atlas tab** for Red / Blue / Yellow, Gold / Silver / Crystal, Ruby / Sapphire / Emerald, FireRed / LeafGreen, HeartGold / SoulSilver, Diamond / Pearl (map, trainers, gyms; its scripts are binary, so no items, NPCs or shops) and Platinum, from the pret decompilations. Platinum in detail: an interactive Sinnoh Town Map (whole-number pixel scale,
  the game's red city / blue landmark / teal special markers). Hover a place for a preview; click, tap or
  press Enter to open it; arrow keys move between places. Filters (has Gym / Mart / Pokémon Center, has
  item, Pokémon appears here, trainer uses move, free text) make matches glow.
- **Location details** in a side panel (bottom sheet on phones): Overview (Gym leader, badge, level cap,
  Poké Mart stock with prices and badge tiers, connections, obstacles), Items (visible, hidden, gift and
  TM spots with tile coordinates), NPCs (dialogue, gifts, trades), Wild Pokémon and Trainers.
- **All 927 Platinum trainers with full teams**, built from the pret/pokeplatinum decompilation: level,
  item, moves, ability, nature and IVs as the game computes them, rematch and starter-dependent
  versions, defensive and offensive matrices, **Load into Builder** and **Calc as attacker / defender**.
- Item database, trainer index (name, class, location, Pokémon, move) and a progress tracker saved on
  the device. The Pokédex Area page links each location to the Atlas.
- `npm run atlas` builds the data; `docs/data-gaps/platinum.md` reports coverage and what is unverified.

### Changed
- The item icon atlas now includes bag items and type-coloured TM/HM icons.
- Bundle budget: the largest lazy chunk may be 320 KB gzipped (a game's Atlas file is ~280 KB).

### Known limits
- Diamond / Pearl, HeartGold / SoulSilver and Generation 5 onward have no Atlas yet.
- Ruby / Sapphire, LeafGreen and Blue / Silver reuse their sibling's data; version-only differences are not applied (see each game's `docs/data-gaps` file).
- 245 trainer entries (unused / daily Pokémon Center trainers) and 15 hidden items sit on maps the
  Town Map does not show; story requirements for reaching areas are not listed.

## 0.7.0 — 2026-09-28

### New
- **Workbench layout.** The builder is one screen: team on the left, the Pokémon's set in the middle,
  a Team check (errors, the types you're most exposed to, common partners) on the right. Navigation
  is Build · Calc · Pokédex plus a More menu (Match log, Meta, Settings & credits); phones get a
  bottom tab bar and an add-Pokémon button.
- **Saved teams as sprite tiles** (six Pokémon on their type colours), readable at a glance on phones.
- **Meta tab** with real usage data: each Champions regulation's most-used Pokémon with their items,
  moves, abilities, spreads and teammates, from Smogon's monthly usage statistics, built into the app
  and refreshed weekly by a GitHub Action. It works offline, says how old the numbers are, and falls
  back to your own logged matches for a regulation without published stats.
- **Picker ordering.** Items, moves and species open in a useful order (staples, STAB, legal first)
  with relevance search, recents and favourites (star, or Alt+F), sticky group headers and an A–Z
  switch. Lists only show what the selected game has.
- **Real Sinnoh map.** Diamond/Pearl, Platinum and BDSP now show Platinum's own Town Map (rendered
  from the pret decompilation) instead of a schematic. Every Area map zooms (buttons, pinch,
  ctrl/⌘ + wheel, double-click) and pans; tapping a marked place highlights it in the list below.
- **iPhone app polish:** safe areas, launch screens, bottom-sheet pickers, 44 pt touch targets,
  16 px inputs (no zoom on focus), dynamic theme colour, keyboard-aware layout.
- Settings & credits dialog with theme, data notes and licences.

### Changed
- New colour system (light and dark) meeting WCAG AA contrast, checked by a test; reduced-motion
  respected everywhere; one set of shared buttons, fields, tabs, menus, notices and empty states.
- Map images are lossless WebP; `docs/MAP_COVERAGE.md` lists what each map places.
- Clearing a team can be undone from the toast.

### Fixed
- **Terastallization only in Scarlet/Violet.** Tera types no longer appear, save, export, import or
  reach the damage calculator in other games (Champions included). Existing saves are migrated; the
  pre-migration save is kept in the browser as a backup (`ptb:v1:backup-v2`).
- Mega Evolution only where the game has it (Champions, Gen 6–7, Let's Go, Legends: Z-A): no Mega
  stones or Mega formes elsewhere; Let's Go no longer lists stones for Megas it doesn't have.
- Z-Moves (Gen 7) and Dynamax (Gen 8) are flagged as not modelled by the calculator instead of
  being silently ignored.
- The Meta tab no longer depends on championsbattledata.com, which was unreliable.

### Under the hood
- Per-game capability flags (`src/domain/capabilities.ts`) drive every gimmick check.
- Versioned store migrations for teams (v3), matches (v2), calculator (v2) and Meta (v2), each
  tested against an old-shape save; saved teams, folders and variations are untouched.
- Bundle-size budget enforced by `npm run build`; pret sources pinned in `scripts/sources.ts`.
- Accessibility: axe-core reports 0 violations on every view (light/dark, desktop/phone);
  Lighthouse accessibility and best practices 100.
