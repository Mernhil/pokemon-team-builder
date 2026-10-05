# Changelog

Releases before 0.7.0 are described on the GitHub Releases page and in the git history.

## 0.24.0 — 2026-10-05

### New
- **Analyse** (main bar, between Calc and Pokédex): Team overview, Speed tiers, the Threat report, the OHKO lists and Compare are now tabs of one view with a single team picker, so you can analyse any saved or shared team without opening it in the builder. `#analyse/speed`, `#analyse/ohko/to` and so on open a tab; every old link (`#speed`, `#threats`, `#ohko`, `#ohkod`, `#showcase`, `#compare`) still works. The two OHKO entries in the menu are one tab with its two lists.
- **Search everything** (Ctrl/⌘ + K, or the search button in the header): find any screen or Analyse tab, your saved teams, a Pokémon (its Pokédex page, or the Calc with it as the attacker), a Pokénav game or a setting.
- **What's new**: after an update a sheet lists what changed since the version you last saw, with a **Try it** link on the notes that name a screen. Settings → What's new shows it any time.

- **Automatic archetype tags.** The app now works out a team's archetype (Rain, Sun, Sand, Snow, Trick Room, Tailwind, Hyper Offense, Bulky Offense, Balance, Stall) from its Pokémon, with the reasons. The match form suggests one for an empty archetype field (one tap to use it); the match log's stats offer **Tag N untagged matches** with a preview and an Undo; saved teams and Team overview show archetype chips. A tag you wrote yourself is never changed.

- **Game day**: team preview to a logged match on one phone screen. Tap their six (a grid of the most used, a search, recent opponents), get the plan (bring four, lead two, why, the main risk, two more plans a tap away), a 6×6 grid of matchups and the speed order of all twelve with Tailwind and Trick Room toggles, note what they show during the game, then tap **Win** or **Loss**: the match is logged with what you brought and led, what they showed and brought, and the archetypes the app worked out, and the next game starts on the same team. Start it from the Match log's **Start a match**, More → Game day, Analyse or the search. The game in progress survives a reload.

- **Benchmarks, notes and a team sheet.** Goals you build a spread for (survive a move, outspeed a Pokémon, KO) can be kept as *benchmarks* on the Pokémon (a box in the Optimise dialog, or **Keep as benchmark** on a Speed tiers or Threat report row). Each shows ✓/✗ for the set as it is now in the editor and in Team overview's Stats tab; when the meta or a regulation change makes a held benchmark stop holding, Team check says so and the Regulation banner lists the ones that would break in the live regulation. Every Pokémon also has a 300-character **Notes** field, and each team has team notes and **matchup notes** (a plan per kind of opponent, with up to two leads). Team overview's new **Notes & sheet** tab edits them and gives a printable **team sheet** (Print, black on white in any theme; Copy as text) with the sets, notes, speed order, matchup notes, replica code and the Showdown export. Benchmarks and notes travel with share codes, backups and cloud sync.

- **Meta trends.** The Meta tab has a **Trends** tab (Rising, Falling, New in the top 20, Dropped out) comparing today's ranking with 7 days ago, 30 days ago or the season start, with text like “▲ 9 places in 7 days” (blue for gains, amber for losses, never colour alone); every Pokémon's card has a small trend line with its own period switch; and Analyse → Threats shows **Rising threats**, Pokémon climbing the ranking that beat several of your team. The history (`meta-history.json`, about 3 KB gzipped, loaded only when needed) is appended by the twice-daily meta job and was backfilled from every daily in-game snapshot since the season began. A change of source (in-game rank vs Smogon %) or of ranked season is shown as a break and never compared across.

- **Tournament teams.** Meta has a **Teams** tab with the top 8 of recent online VGC tournaments (events with 32+ players in the last 60 days, from Limitless open team sheets): six sprites, placing, event and date; filters for Pokémon (several), archetype, Mega and dates; sort by date or placing; and “Source: Limitless” with a link on every team. Open a team for its sets and **Import as a team** (saved in “Tournament teams”, source link in the notes), **Compare with mine**, **Plan vs this team** (the bring planner with their known sets) or **Practice in Game day** (their six pre-filled). Team sheets carry no spreads, so an imported team gets each Pokémon's most common meta spread (or an estimate from base stats) and every set says “Spread estimated”.

- **Choose your main tabs.** Settings → Navigation lets you pick what the bottom bar (phone, 2 to 4 tabs) and the top bar (desktop, 3 to 6) show; everything else is under More, and Reset restores the default. For **Pokémon Champions** the default bar no longer has Pokénav (it has no use there): Reverse search takes its place, and Pokénav stays one hash (`#atlas`), search or a chosen tab away.

### Changed
- **The menu is reorganised.** More now holds Match log, Meta, a Tools group (Reverse search, Regulation diff) and Settings. On a phone the bottom bar is Build, Calc, Analyse, Pokédex and More, with Pokénav under More.
- **Desktop updates now come from a separate public releases repository** (`Mernhil/pokemon-team-builder-releases`), so the app's own repository can be made private. This is the transition release: it is published to both places, so apps installed before it find it where they always looked. Nothing changes in the app itself.
- **Fewer CI minutes:** documentation-only changes skip CI, and the iPhone WebKit tests run only on a pull request that changes the app.
- **Champions learnsets come from Showdown's current Champions data** (a newer pinned checkout) instead of the older @pkmn/mods release, for every Pokémon it covers (@pkmn/dex and @pkmn/mods are already at their latest versions).
- The single-file artifact build is gone (the app ships as the web app and the desktop app), and the regulation banner no longer says when the data was "checked".

### Fixed
- **Champions data audit** (`npm run data:audit`, also a weekly check against Showdown) found and fixed these gaps: the Squawkabilly colour formes (Blue, White, Yellow) were missing from Reg M-C, and 41 Pokémon had learnsets that lagged Showdown's current Champions data: about 70 moves were missing (Slash on Absol, Aegislash, Gallade, Skarmory and more; Megahorn on Gogoat; Wish on Indeedee; Sirfetch'd, Golisopod and Grapploct lacked a dozen each) and about 80 were wrongly listed (Toxic, Swagger and Double Team on Mr. Mime, Farfetch'd and Golisopod). 22 intentional differences are explained in `scripts/audit-allowlist.json` (for example the new Megas' abilities, which follow the announcements rather than Showdown's placeholders).

## 0.23.0 — 2026-10-05

### New
- **Team overview** (More → *Team overview*, or **Overview** on a team in Saved teams): pick a saved team (or the build in progress) and see all of it at a glance, read-only, like the in-game team screen. **Moves & More** shows each Pokémon's ability, item and moves, **Stats** its finished stats with their SP or EVs and the nature's raised and lowered stat, and **Team** the speed order and both type matrices. The six Pokémon sit two to a row, so the whole team fits one phone screen; *Show Megas* switches the cards to the Mega formes.
- **Reverse search: "Has to know a move".** Pick up to four moves every answer has to know, alone or on top of the other conditions, e.g. a Fake Out user that one-shots Sylveon. Only Pokémon that can learn the move in the format show up, and each is built to know it: if its usual set lacks the move, it goes in place of a status move first (then its last attack), and the result says what it replaced. The calculations use the build with the move in it.

## 0.22.0 — 2026-10-04

### New
- **Recommended items and way to use** (Champions): a light-bulb info button next to the held item's own lists the items people actually run on that Pokémon, with usage %. A **Recommended way to use** section under the Pokémon shows its most-used items (tap one to take it), ability, nature, spread and moves, and **Use the most-used build** applies them all in one go (Undo puts yours back).

### Fixed
- **Abilities now count in the type matrices and suggestions.** Rotom-Wash with Levitate was shown weak to Ground. The defensive matrix, Team check's *Most exposed to* and its suggestions now apply Levitate, Flash Fire, Water Absorb, Volt Absorb, Lightning Rod, Storm Drain, Sap Sipper, Motor Drive, Earth Eater, Well-Baked Body, Dry Skin, Thick Fat, Heatproof, Water Bubble, Fluffy, Purifying Salt and Wonder Guard (and a Mega Stone holder's Mega ability). The offensive matrices, the calculator's move coverage, Matchup builder, bring planner and Reverse search's *resists* condition apply the Pokémon's own abilities too: Pixilate, Aerilate, Refrigerate, Galvanize and Normalize, Scrappy and Mind's Eye, Tinted Lens, and Mold Breaker ignoring the target's ability. A Pokémon's Pokédex page lists what each of its abilities does to incoming types.

## 0.21.1 — 2026-10-04

### Fixed
- **Damage Calc:** the ability's info card now describes the Mega's ability while a Pokémon is Mega Evolved (Chandelure-Mega showed Flash Fire's description next to Infiltrator).

## 0.21.0 — 2026-10-04

### New
- **OHKO reports** (Team check links, and More → *OHKO’d by* / *Can OHKO*): for each of your Pokémon, which of the most-used Pokémon can OHKO it, and which of them it can OHKO. Guaranteed OHKOs come first, then ones that only happen on some damage rolls (switch those off with *Possible OHKOs*), each with the move, the damage, who moves first and its usage; tap a row to open it in the Damage Calc. Same engine and meta data as the Threat report; Champions only.
- **Edit team** in Saved teams: loads a saved team (or one of its variations) into the builder so you can change it; **Save** then offers to *Update* that team, or save the result as a separate one.

### Changed
- **Saved teams no longer change while you build.** Saving keeps a copy and leaves your build open as a separate draft, so trying a change after saving no longer alters the saved team. A saved team only changes when you Save over it from an Edit team session. Opening, duplicating, importing or adding a variation also loads a draft copy. A saved team that an older version left open is kept as it was, with a draft copy in the builder.
- **Reverse search and Optimise spread use the builder's stat sliders and nature picker** for the opposing Pokémon (with the nature +/− buttons and presets), instead of number boxes and a drop-down.

## 0.20.0 — 2026-10-04

### New
- **Move coverage in the Damage Calc:** a panel under Results shows, for each side, the best multiplier of the moves currently selected against all 18 types (×2, ×1, ½, 0), updating live as you change a move. It counts the types the move hits super-effectively, lists the ones that resist or block it, and outlines the opposing Pokémon's own types. Hover a type to see which moves reach that multiplier.

### Changed
- **Type filters show the type badges.** The Pokédex list's *Type* dropdown is now a row of type badges (tap one to filter, tap it again or *All types* to clear), the same control as the Moves tab's type filter.
- **Optimise spread is more granular.** When you add a goal, the other Pokémon's move now comes with one-tap suggestions (the moves people actually run on it, with usage %, or your own moves for *Knock out*) and the builder's full move search over its whole learnset. Only attacking moves can be added. A new section under the goal lets you edit the other Pokémon's item, ability, nature and spread (SP or EVs) before you add it, for Survive, Knock out and Outspeed goals.

## 0.19.0 — 2026-10-04

### New
- **Reverse search** (More → Reverse search): say what a Pokémon has to do and get every Pokémon that does it. Combine conditions: *one-shots* a Pokémon (guaranteed, or "possible OHKO counts"), *survives* it (one or two hits), *resists* its attacking types, *outspeeds* it (Trick Room aware). The opponent loads its most-used set, which you can edit, and weather, terrain and Trick Room can be set. Answers use the same engine as the Damage Calc, show the numbers behind them ("Armor Cannon 181–212% · takes up to 64% from Throat Chop") and have **Add to team** and **Open in Calc**. Pokémon with usage data are judged on their most-used set; the rest get a generic attacker build with no item, and every result says which one it used.
- **Mega Evolutions in the Champions Pokédex:** a **Mega Evolutions** mode lists the Megas of a regulation in Pokédex order, a Pokémon's Megas side by side (Charizard X then Y, Garchomp then Mega-Z), with the stone and the regulation each arrived in. A new **Regulation** picker browses the roster as it was in M-A, M-B or M-C. A Mega's page shows its Pokémon's moves, and **Add to team** adds that Pokémon holding the stone.
- **Pokédex Moves tab:** filter a Pokémon's moves by type.
- **Aegislash and Palafin forms:** the stats panel switches between Base and Blade (or Hero) with both sets of stats side by side. The Damage Calc now uses Blade stats when Aegislash attacks and Shield stats when it defends (Palafin stays in its base form unless you pick Hero), everywhere the calculator is used (Threat report, bring planner, optimiser, reverse search). A **Form** choice (Auto / Base / Blade or Hero) in the calculator and Advanced details overrides it.
- **The game's own Battle Data** is now the Meta tab's first source for the live regulation (ranked usage from the Champions Battle Data screen, via a community mirror). It publishes a usage *rank*, not a percentage, so the Meta tab, Threat report, Speed tiers and Team check show "#3" where there is no percentage. Smogon still covers ended regulations and is the fallback.
- **Type matrices:** the defensive matrix and Team check now read weak / resist / **immune**, so a Pokémon that takes no damage from a type (Aegislash and Fighting) is called out instead of counted as a resist. The offensive matrix separates resisted hits from moves with **no effect**.

### Changed
- **Teams are named when you save them.** The team-name box in the header is gone (edits already save into the open team, so it and the Save dialog were two ways to name a team and made same-named copies). Rename a team in Saved teams.
- **Save under a name that is taken** asks whether to add the build as a variation of that team (the default) or overwrite it.
- **Clear this team** on a saved or named team starts a fresh team and leaves the saved one as it was, with Undo. Before, it emptied the saved team.

### Fixed
- **Champions move pools:** evolutions now inherit their pre-evolutions' egg and level-up moves. Rillaboom was missing Fake Out (it is Grookey's egg move); 72 moves were missing across 43 Pokémon, including Pawmot's Fake Out, Cinderace's High Jump Kick and Sucker Punch, Persian-Alola's Parting Shot and Wigglytuff's Wish.
- **Meowstic's Megas** were listed as ordinary Pokémon in the Pokédex and the species picker; they are Megas now. Legends: Z-A was also missing Mega Meowstic, Tatsugiri and Magearna.

## 0.18.0 — 2026-10-03

### New
- **Playthrough / Nuzlocke tracker:** a **Run** page in Pokénav (next to Map, Items, Trainers and Progress) for every game, with several runs per game and a run switcher. Log what you meet in each place with one tap (caught, fainted, fled), gifts and trades by hand, keep your party, box and graveyard (with where and why a Pokémon died), and set your own rules: first encounter per area, dupes clause (it knows evolution lines), shiny clause, species clause, soft or hard level caps and your own notes. A summary at the top shows badges, how many are alive or dead and the **next level cap** ("Next cap: 26 (Fantina)"), and warns when a party member is over it. **Next boss** shows the next Gym leader, Elite Four member or Champion's team, how your party's types fare against it, **Calc vs boss** in the game's own format and **Load party into Builder**. On the map, places show whether their wild encounter is available, used or absent. Encounters-only games (Gen 5 onward) track encounters, the party and deaths, without caps or bosses.

## 0.17.0 — 2026-10-03

### New
- **Share teams with a friend:** with sync on, the share button on a saved team shares it and all its variations with one other person as *can view* or *can edit*. Their copy appears under **Shared with me** with your name on it; a view-only team opens read-only with **Make my own copy**, and with *can edit* they can change it and add variations (your own sync receives their changes). If you both change the same team, the older change is kept as a team of the editor's own, so nothing is lost. You can stop sharing any time and the other person can leave. Set a display name in Settings → Sync.
- **Share your match log** (view only): your friend's matches show up as a separate choice in the Match log and Meta tabs (*Mine / their name / Both of us*) and only count in your statistics when you pick *Both of us*.
- **Notices:** a toast tells you when the other person changed something you can see ("Ash updated “Rain M-C” 2 h ago.").
- **Compare teams** (More → Compare teams): two teams side by side (yours, shared, or two variations of one team) with both type matrices, speeds, top threats and a set-by-set diff of species, item, ability, nature, moves and spread. Variations of the same team are called out.

### Setup
- Needs the new D1 migration: run `npx wrangler d1 migrations apply pokemon-team-builder --remote` **before** deploying this version (docs/SYNC.md). Until it is applied, cloud sync answers with an error.

## 0.16.0 — 2026-10-03

### New
- **Speed tiers:** a ladder of the most-used Champions Pokémon's likely Speeds (from the published usage spreads, with Mega and Choice Scarf rows) with your team's Pokémon on the same scale and Speed ties called out. Toggle Tailwind, −1/+1/+2, paralysis and Choice Scarf for each side, plus weather, terrain and Trick Room (which flips the order). Tap a meta Pokémon for **Outspeed this**: the Stat Points and nature your selected Pokémon needs to beat it, with an undoable Apply. Under More → Speed tiers, and linked from Team check.

- **Threat report:** your whole team against the most-used Champions sets on one screen: your best move and its best move (OHKO / 2HKO / 3HKO+ with damage ranges), who moves first, and plain-language summaries of the worst threats. Change the field (Doubles/Singles, weather, terrain, Trick Room) or the number of threats and everything updates; tap a cell to open it in the Damage Calc. Under More → Threat report, with a "Top threats" line in Team check.

- **Stat Point optimiser:** an **Optimise** button in the stat calculator finds the cheapest spread for goals like "survive Garchomp's Earthquake", "outspeed Flutter Mane under Tailwind" and "2HKO Kingambit", then puts the leftover points where you say (one stat, or max HP and an even split). It can suggest a nature, tells you how short an unreachable goal falls and what could help, and applies with Undo. Works for Champions Stat Points and Gen 3–9 EVs. Also reachable from Speed tiers ("Optimise…") and the Threat report ("Survive this…").

- **Match log: brought, led and analytics:** record which Pokémon each side brought and led by tapping their sprites (doubles bring 4 / lead 2, singles 3 / 1), all optional. The stats now have filters (regulation, category, dates, team or variation) and show win rate by your lead, by the four you brought and by team variation, the record against each opponent Pokémon (on their team / brought / led), a nemesis list that links to the Damage Calc, Speed tiers and the Threat report, a weekly win-rate chart and an archetype-vs-archetype grid. Every rate shows a 95% range, and fewer than 5 games is greyed out without a percentage. The CSV export has the new columns.

- **Bring planner:** "Plan vs this team" suggests which four to bring and which two to lead against the opponent's six, with the three best plans, plain reasons and the main risk. Add their Pokémon as species, paste their team, load a logged match or use a saved enemy team; unknown sets use the most-used set, and what you know overrides it. Only one Mega per plan. "Use this plan" saves what you bring and lead onto the match. On a logged match and in the Matchup tab.

- **Regulation changes:** a new **Regulation diff** page (More → Regulation diff) compares two regulations: what was added or removed (Pokémon, Megas, items, moves, abilities), species changes as before → after, and unconfirmed entries. Saved teams show a badge when they're not in the live regulation and which of their Pokémon, items or moves aren't legal in it. The regulation banner now shows what moving a team to the live regulation breaks, changes or newly allows, and **Copy to <regulation>** makes a variation with the illegal parts removed and a checklist (the original is untouched). A next regulation with a start date counts down in the banner.

- **Cloud sync (web and phone app):** an opt-in way to keep your teams and match log the same across devices (Settings → Sync). It works offline and syncs when it can; if two devices change the same team, the older change is kept as a "Conflict copy" variation so nothing is lost. It needs a one-time setup on the Cloudflare side (docs/SYNC.md); until then the app behaves as before and Settings says sync isn't set up. The desktop app doesn't sync yet.

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
