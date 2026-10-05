# Weekly regulation update — runbook

The weekly scheduled task follows this file. A person can follow it too.

The goal is to keep `src/data/regulations/` in step with the official Pokémon Champions regulation calendar, and to ship each new regulation on or before its start date.

## 0. Setup

```bash
git clone https://github.com/Mernhil/pokemon-team-builder.git && cd pokemon-team-builder
npm ci
npm run reg:status        # what the app currently knows: live set, end date, announced sets
```

## 1. Research

Search the web for Pokémon Champions regulation news from the last ~10 days, e.g. "Pokémon Champions Regulation Set M-D", "Champions next regulation", "Champions regulation <month year>".

- **Primary sources:** pokemon.com news, the official Pokémon / Play! Pokémon accounts, in-game notices.
- **Cross-check sources:** Victory Road (victoryroad.pro), Pokémon Zone (pokemon-zone.com/champions/regulations), Serebii, Bulbagarden, MetaVGC, Pikalytics.

Record for each regulation found:

- id, name and short name (e.g. `champions-reg-md`, "Champions · Reg M-D", "Reg M-D")
- start and end date/time in UTC
- Pokémon added and removed, including regional forms and Mega Evolutions
- items added and removed
- moves added and removed
- abilities or Mega abilities that differ from Showdown data
- rule changes: bring/pick, level, clauses, timers, gimmicks

**Source rules:**
- An addition goes in only if the official source or ≥ 2 independent sites confirm it.
- Anything backed by one site only goes under `unconfirmed` with a note. Never add it to the legal lists.
- Ignore rumours, datamine speculation and ladder-usage "discoveries".

## 2. Decide what to change

Compare the research with `npm run reg:status`.

| Situation | Action |
|---|---|
| Nothing new | Change nothing: no commit, no branch, no PR. (There is no `lastChecked` any more; a quiet week leaves no trace.) |
| Next set announced, details not published yet | Add it to `schedule.json` → `upcoming` with name, dates, one-line summary and sources. |
| Details published (before or after the start date) | Create `src/data/regulations/<id>.json` and remove the entry from `upcoming`. |
| An existing set changed (ban, errata, extension) | Edit that file and bump its `updatedAt`. |

## 3. Write the regulation file

Copy `champions-reg-mc.json` as a template. It uses `"base": { "extends": "<previous id>" }` and lists only the deltas:

- `addSpecies` / `removeSpecies` / `addItems` / `removeItems` / `addMoves` / `removeMoves` — Showdown ids, meaning lowercase alphanumerics (`toxtricitylowkey`, `garchompitez`).
- `speciesPatches` — override `abilities`, `types` or `baseStats` when the official data differs from Showdown.
- `newAbilities` — `{ id, name, shortDesc }` for abilities Showdown doesn't have yet.
- `newSpecies` / `newItems` — full definitions for Pokémon or items Showdown doesn't know at all:
  - species: `id, name, num, baseSpecies, forme, gen, types, baseStats, abilities, requiredItem, learnsetFrom`
  - items: `id, name, shortDesc, megaStone`
  - Learnsets for these are flagged as provisional in the UI.
- `unconfirmed`, `sources` (every URL you used) and `updatedAt` (today).

Before hand-writing definitions, try the Showdown data first:

```bash
npm update @pkmn/dex @pkmn/mods     # Showdown may already ship the new set
```

If a new Showdown mod exists for the regulation (like `championsregma`), prefer `"base": { "showdownMod": "..." }` and register the mod in `scripts/build-data.ts` → `MODS`.

## 4. Rebuild and verify

```bash
npm run data:strict        # fails on any id Showdown/newSpecies can't resolve — fix ids, don't skip
npm run sprites -- champions   # picks up sprites for new species/Megas (PokeAPI)
npm run meta -- --sources carryover   # the new regulation's provisional Meta data: the previous one's usage for what's still allowed (offline)
npm run data:audit -- --strict   # vs Showdown's current Champions mods; docs/data-audit.md says what differs (explain intended ones in scripts/audit-allowlist.json)
npm run typecheck && npm test
npm run reg:status         # confirm dates, counts and the LIVE marker
```

Add a test to `src/domain/__tests__/regulations.test.ts` for the new set: one added species, one new item and the live-date switch.

If a sprite is missing because PokeAPI hasn't added a new Mega yet, the app falls back to an initials avatar. That's acceptable; note it in the summary.

## 5. Ship

Only when regulation data changed. On a quiet week stop here.

1. Branch off the default branch (`claude/pokemon-team-builder-otextg`), e.g. `reg/champions-reg-md`.
2. Bump the version so the desktop app gets the data too: `npm run bump -- <next patch>`, plus a `CHANGELOG.md` section for it (one version bump per PR; every bump has a section).
3. Commit with a message like `data: add Champions Reg M-D (starts 2026-12-02)`, push, and open a PR into the default branch. Merging redeploys the web app and, through the version bump, publishes the desktop installers (docs/DESKTOP_RELEASES.md).
4. Send the owner a short summary:
   - what changed
   - start and end dates
   - counts before and after
   - unconfirmed items
   - sources
   - anything that failed

## Never

- Invent Pokémon, stats, abilities or dates.
- Delete a past regulation file. Old teams still validate against it.
- Skip the tests or `data:strict` to ship faster.
