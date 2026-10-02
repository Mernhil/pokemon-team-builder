# Changelog

Releases before 0.7.0 are described on the GitHub Releases page and in the git history.

## 0.14.0 — 2026-10-02

### New
- **Type matrix suggestions:** the Defensive and Offensive type matrices now call out your team's real problems in plain language, worst first — e.g. "Fire is a big problem for your team: 3 of your 6 Pokémon are weak to it" or "You have no super-effective attacks against Poison, and most of your team is resisted or walled by it." When a single type would fix 2 or more of those problems at once, it's suggested directly — e.g. "A Water-type Pokémon would resist 3 of your weak types: Fire, Ice and Steel." The full problem list sits behind a collapsed disclosure so it doesn't crowd the matrix, except a high-severity problem, which stays visible without a tap.

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
