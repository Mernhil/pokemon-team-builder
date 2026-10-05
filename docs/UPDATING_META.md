# Meta tab data — how it's sourced and updated

The Meta tab shows the most-used Pokémon of each Champions regulation with their common items,
moves, abilities, spreads and teammates; the threat report, speed tiers, Stat Point optimiser and
bring planner build on the same data. The app is offline-first: the data is **built into the app**
and never fetched from a third party at runtime.

## Where the numbers come from

One snapshot per regulation: the best source available, in this order (`metaSourceRank` in
`src/domain/meta.ts`; the app and the build script use the same ranking).

| Rank | Source | Kind | Built by |
|---|---|---|---|
| 1 | **Pokémon Champions' in-game Battle Data** for the current ranked season: the game's own ranked Doubles usage (the real ladder), daily, from the community mirror [Gheist23/pokemonbattledata](https://github.com/Gheist23/pokemonbattledata) | `ingame` | `scripts/meta/ingame.ts` |
| 2 | [Smogon usage statistics](https://www.smogon.com/stats/): monthly "chaos" JSON from rated Pokémon Showdown ladder battles, for the regulation's VGC format (`[Gen 9 Champions] VGC 2026 Reg M-C` → `gen9championsvgc2026regmc`, Bo3 variant as a fallback), highest rating cutoff published (1760 → 1630 → 1500 → 0) | `smogon` | `scripts/meta/smogon.ts` |
| 3 | Hand-maintained entries (`src/data/meta/manual.json`) | `manual` | a person, by hand |
| 4 | **Provisional:** [Limitless](https://play.limitlesstcg.com) tournament team lists, at least 64 teams | `tournaments` | `scripts/meta/limitless.ts` |
| 5 | **Provisional:** public [Showdown replays](https://replay.pokemonshowdown.com/), at least 150 games | `replays` | `scripts/meta/replays.ts` |
| 6 | **Provisional:** fewer tournament teams, then fewer replays | | |
| 7 | **Provisional:** the previous regulation's numbers, carried over | `carryover` | `carryOverSnapshot` |
| 8 | The player's own logged matches | `matches` | automatic, on the device |

All but 3 and 8 end up in `src/data/generated/meta.json`, built by `npm run meta` / the daily
GitHub Action. A refreshed copy (the Meta tab's **Check for newer data**, web app only) is the deployed
site's own `meta/latest.json` — the same file — validated before use and kept on the device. If it
fails for any reason, the built-in data stays on screen.

### The in-game Battle Data (`scripts/meta/ingame.ts`)

Pokémon Champions shows each ranked season's usage in its Battle Data screen. A community mirror saves
a dated JSON snapshot of it every day (`data/meta/index.json` lists the seasons and days;
`data/meta/<season>/<dd_mm_yyyy>/Doubles.json` is one day), read from raw.githubusercontent.com
(`INGAME_DATA_BASE` overrides the base URL). Each run takes the newest Doubles snapshot of the newest
season and files it under the regulation live on that day, but only when:

- the season has at least 3 days of snapshots (a season's first days are thin; until then the
  previous season's last snapshot, already in `meta.json`, stays in use), and
- at least 98% of the species in it are legal in that regulation (so a season is never filed under
  the wrong one).

What it has and hasn't: the game publishes a **usage rank** per Pokémon, not a percentage, so these
entries carry `usageRank` instead of `usagePct` and the app shows "#3" where it would show "47.2%".
Moves, items, abilities, natures and Stat Point spreads come with percentages; teammates are ranked
only. Natures and spreads are separate lists in the game's data, so each spread is shown with the
species' most common nature. While a regulation's current season has in-game data, the early
estimates below aren't built for it; Smogon's stats still cover ended regulations and are the
fallback whenever the mirror can't be read (the last good snapshot stays in the meantime).

The data belongs to the game; the mirror is unofficial and states no licence for it. Fine for this
private app, but if the mirror disappears, the pipeline simply falls back to Smogon.

### Before Smogon publishes: the provisional sources

Smogon publishes a month's statistics a few days after the month ends, so a new regulation has no
Smogon numbers for its first 3–5 weeks. Until it has, the script builds the other sources every run
(and stops fetching them for that regulation as soon as Smogon has a month):

- **Carry-over** (from day one, offline): the previous regulation's snapshot, keeping only the
  Pokémon, items, moves and teammates the new one allows. The percentages stay the old regulation's;
  Pokémon new to the regulation aren't in it. Your own logged matches of the new regulation are shown
  instead when you have some (the Meta tab offers the carry-over as an alternative).
- **Tournament team lists** (from the first weekend): Limitless' public API, tournaments dated inside
  the regulation with at least 16 players. Open team sheets give every member's item, ability and
  moves. A tournament counts when its format is listed in `LIMITLESS_FORMATS`, or — when that isn't
  set — when at least 80% of its teams are legal in the regulation and at least half hold a Mega Stone
  (only Champions has them; this keeps Scarlet/Violet events out). The run log prints the format codes
  it used and skipped: pin them in the repository variable `LIMITLESS_FORMATS` once known.
  `LIMITLESS_GAMES` (default `VGC`) is the Limitless game id; the secret `LIMITLESS_API_KEY` is sent
  as `X-Access-Key` if Limitless asks for a key.
- **Showdown replays** (from the first days): the replay search for the regulation's format(s),
  newest first, each new replay's log read once (up to 1,500 per format per run; parsed games are
  cached in `.cache/meta/`, which the Action keeps between runs). Team Preview shows all six Pokémon
  of both teams, so usage and teammates are exact *for the sample*; moves, items and abilities only
  count when the battle revealed them (as a % of the games the Pokémon was brought to), so they read
  low. The games used are those at the highest rating cutoff (1500 → 1300 → 1100 → 0) with at least
  150 of them. Only replays players chose to upload are public, so it's a sample, not the ladder.

Neither replays nor team lists show spreads, which the threat report, speed tiers, optimiser and
bring planner need: each species gets the spreads of the nearest other regulation's Smogon statistics
(`spreadFrom: "<regulation id>"`), else one estimated from its base stats (`spreadFrom: "estimate"`).
The Meta tab marks provisional data, says which source it is and what it can't show.

**Reliability / terms.** Smogon's statistics are published openly and have been produced monthly for
over a decade; they cover Showdown ladder play (not in-game Champions ranked play). Showdown's replay
server and Limitless' API are public; the script identifies itself, keeps at most 3–4 requests in
flight, retries politely and never re-reads what it has cached. The app credits every source and links
it on the Meta tab. Pikalytics, Pokémon Zone and similar sites derive from the same data and don't
allow automated use, so they aren't used. championsbattledata.com (used before 0.7.0) was dropped as
unreliable.

## Automatic updates

`.github/workflows/meta.yml` runs twice a day, at 06:17 and 19:47 UTC (and on demand from the Actions
tab). The mirror publishes in the evening UTC and sometimes a day late, so a single morning run kept
seeing yesterday's files and reported "No change in the data"; the evening run picks up what the
mirror published in the meantime.

1. `npm run meta` — every source above; a source that fails keeps its previous snapshot in play, and
   a file that fails validation is never written. A day with no new numbers changes nothing.
2. `npm run meta:check` — the guard (`scripts/check-meta.ts`, rules in `src/domain/metaGuard.ts`): the
   new `meta.json` must validate, must not drop a regulation that had data and must not shrink one to
   under half its entries.
3. `npm run typecheck && npm test` with the new data.
4. If `meta.json` changed: commits it straight to the default branch (the guard, typecheck and tests
   above are the checks; nothing to merge by hand). **The push redeploys the web app.** Desktop apps
   pick it up with their next release. If the branch is protected and refuses the push, the run opens
   (or updates) the `meta/update` pull request instead, to merge by hand.
5. `npm run meta:check -- --lag` — the stall check: fails the run when the in-game data in `meta.json`
   trails the mirror's newest snapshot by more than 2 days.

**Alerts.** When a scheduled run fails (any step, including the stall check), the `alert` job opens one
issue, "Meta data update failing", or comments on it if it is already open, with the run link. The next
successful scheduled run closes it. A mirror that is itself behind does not trip this; it shows in the
run log ("Mirror newest …").

Only for the pull request fallback: Settings → Actions → General → Workflow permissions → tick
**Allow GitHub Actions to create and approve pull requests**.

## Running it by hand

```bash
npm run meta                                # every source; needs www.smogon.com, replay.pokemonshowdown.com, play.limitlesstcg.com
npm run meta -- --sources carryover         # offline: just the carry-over for regulations without Smogon data
npm run meta -- --sources smogon,replays --max-replays 300
npm run typecheck && npm test
```

The script prints, per regulation, what each source found (format, month, cutoff, games or teams,
number of Pokémon) and which one it used, and lists any Showdown species name the Champions dataset
doesn't know (those are dropped — fix the dataset, never the numbers).

## Hand-maintained data (`src/data/meta/manual.json`)

Use this only when there's a reliable source that isn't Smogon (e.g. official tournament usage) for a
regulation Smogon doesn't cover yet. Same schema as `meta.json`, validated by `src/domain/meta.ts`
(`MetaFileSchema`) in the tests and when the app loads it:

```jsonc
{
  "version": 1,
  "generatedAt": "2026-10-01",
  "regulations": {
    "champions-reg-mc": {
      "regulationId": "champions-reg-mc",
      "updatedAt": "2026-10-01",
      "source": { "name": "…where the numbers come from…", "url": "https://…" },
      "entries": [
        {
          "speciesId": "incineroar",          // Showdown id, lowercase alphanumerics
          "usagePct": 41.2,                    // % of teams, 0–100
          "items": [{ "id": "sitrusberry", "pct": 38 }],
          "moves": [{ "id": "fakeout", "pct": 97 }],
          "abilities": [{ "id": "intimidate", "pct": 99 }],
          "teammates": [{ "id": "rillaboom", "pct": 31 }],
          "spreads": [{ "nature": "Careful", "values": [32, 0, 20, 0, 14, 0], "pct": 12 }]  // HP/Atk/Def/SpA/SpD/Spe
        }
      ]
    }
  }
}
```

Rules: every number must come from the named source; leave a list empty rather than guess. Hand-entered
data ranks under Smogon's statistics and above the provisional sources (add `"kind": "manual"` to the
`source`, or leave `kind` out with a non-Smogon `url`).
