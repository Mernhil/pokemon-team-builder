# Meta tab data — how it's sourced and updated

The Meta tab shows the most-used Pokémon of each Champions regulation with their common items,
moves, abilities, spreads and teammates. The app is offline-first: the data is **built into the
app** and never fetched from a third party at runtime.

## Where the numbers come from

| Priority | Source | File | Updated by |
|---|---|---|---|
| 1 | [Smogon usage statistics](https://www.smogon.com/stats/): monthly "chaos" JSON from rated Pokémon Showdown ladder battles, for the regulation's VGC format (`[Gen 9 Champions] VGC 2026 Reg M-C` → `gen9championsvgc2026regmc`, Bo3 variant as a fallback), highest rating cutoff published (1760 → 1630 → 1500 → 0) | `src/data/generated/meta.json` | `npm run meta` / the weekly GitHub Action |
| 2 | Hand-maintained entries (for a regulation Smogon doesn't cover yet) | `src/data/meta/manual.json` | a person, by hand |
| 3 | The player's own logged matches | (their match log) | automatic, on the device |

A refreshed copy (the Meta tab's **Check for newer data**, web app only) is the deployed site's own
`meta/latest.json` — the same file as (1), emitted by `vite.config.ts` — validated before use and
kept on the device. If it fails for any reason, the built-in data stays on screen.

Smogon publishes a month's statistics a few days after the month ends, so a new regulation has no
published numbers for its first weeks: the tab says so (or shows the player's own matches).

**Reliability / terms.** Smogon's statistics are published openly and have been produced monthly for
over a decade; they cover Showdown ladder play (not in-game Champions ranked play). The app credits
Smogon and links the exact file on the Meta tab. Pikalytics and similar sites derive from the same
Showdown data and don't allow automated use, so they aren't used. championsbattledata.com (used before
0.7.0) was dropped as unreliable.

## Automatic updates

`.github/workflows/meta.yml` runs every Monday (and on demand from the Actions tab):

1. `npm run meta` — looks back up to 8 stats months for each Champions regulation, keeps the previous
   snapshot for any regulation without published stats, never writes a file that fails validation.
2. `npm run typecheck && npm test` with the new data.
3. If `meta.json` changed: opens (or updates) the `meta/update` pull request. **Merging it redeploys
   the web app.** Desktop apps pick it up with their next release.

One-time setting: Settings → Actions → General → Workflow permissions → tick **Allow GitHub Actions to
create and approve pull requests**.

## Running it by hand

```bash
npm run meta              # needs access to www.smogon.com
npm run typecheck && npm test
```

The script prints, per regulation, the format, month, cutoff, battle count and number of Pokémon, and
lists any Showdown species name the Champions dataset doesn't know (those are dropped — fix the
dataset, never the numbers).

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

Rules: every number must come from the named source; leave a list empty rather than guess; the
automated file wins whenever it has data for the same regulation.
