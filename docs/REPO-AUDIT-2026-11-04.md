# Repo audit, 2026-11-04

Read-only audit of `Mernhil/pokemon-team-builder` (public). Everything below comes from git (`git fetch --all --prune`, default branch pulled to `0cd4314`, v0.39.3), the public GitHub API and a fresh clone, not from CLAUDE.md or the October roadmap files. Where they disagree, this file records what was found. Nothing was deleted, merged, closed or changed; the only change is this file.

**What could not be checked.** `gh` is not installed and there is no GitHub login here, so only the unauthenticated API was used (60 calls/hour): no job logs, no PR creation, no settings. The deployed site (`pokemon-team-builder.<account>.workers.dev`, behind Cloudflare Access) and the Cloudflare dashboard are unreachable, so whether `/api/health` answers and the D1 binding is live are inferred, not observed. The "match-import" prompt is not in the repository, the roadmap files or any branch.

## 1. Safe to delete

None of these has an open PR. Run from a machine that is logged in to GitHub; each command is permanent.

### 1a. Merged into the default branch (`git branch -r --merged`; 0 unique commits): 34 branches

``bash
git push origin --delete claude/adoring-noether-4u9re3
git push origin --delete claude/awesome-curie-4qzqjw
git push origin --delete claude/bold-meitner-mvjw5y
git push origin --delete claude/charming-cannon-vf4heh
git push origin --delete claude/code-optimization-security-check-1mp13x
git push origin --delete claude/code-review-release-setup-lh6oi9
git push origin --delete claude/compassionate-cannon-f9gb0l
git push origin --delete claude/dazzling-cori-fq5zka
git push origin --delete claude/epic-hamilton-808b7h
git push origin --delete claude/finish-prompts-lxv6r4
git push origin --delete claude/focused-hopper-0ibrye
git push origin --delete claude/focused-hypatia-4yszwm
git push origin --delete claude/great-fermat-91ikzn
git push origin --delete claude/inspiring-hamilton-a9qmay
git push origin --delete claude/keen-hypatia-srsrl6
git push origin --delete claude/keen-tesla-gycipu
git push origin --delete claude/nice-bell-inepad
git push origin --delete claude/nifty-pasteur-3bs2sm
git push origin --delete claude/season-end-banner
git push origin --delete claude/serene-darwin-gpro0l
git push origin --delete claude/sharp-pascal-cj9mw3
git push origin --delete claude/sweet-edison-48qyqt
git push origin --delete claude/sweet-ride-c4y10s
git push origin --delete claude/trusting-hypatia-q6j7ti
git push origin --delete claude/upbeat-galileo-em6gep
git push origin --delete coverage-matrix-suggestions
git push origin --delete matrix-fix-suggestions
git push origin --delete moves-ordered-by-type
git push origin --delete nature-picker-visibility
git push origin --delete release/0.12.0
git push origin --delete release/0.13.0
git push origin --delete release/0.14.0
git push origin --delete release/0.15.0
git push origin --delete suggestion-chips
``

### 1b. Squash-merged PRs, nothing added after the merge: 7 branches
Not shown by `--merged` because the PRs were squash-merged. Each has a merged PR, no commits after the merge, and (for #68 and the Release-workflow branch) a three-way merge that adds nothing.

``bash
git push origin --delete claude/pokemon-matches-tab-bugs-gtt6kp
git push origin --delete claude/gracious-hypatia-0ofqdb
git push origin --delete claude/affectionate-fermat-cak4ti
git push origin --delete claude/serene-einstein-guoto3
git push origin --delete claude/modest-einstein-g1o5oh
git push origin --delete claude/magical-davinci-nyu04i
git push origin --delete claude/peaceful-planck-75ohjj
``

### 1c. Probably ported, check first: 3 branches
Commits after the PR merged, but the work is on the default branch under other PRs: `new-session-ypxlqe` (team sharing and compare shipped in 0.17.0), `festive-newton-to6zx8` (0.25.1 release fix superseded by #42 to #45; the "first install" fix is covered by an e2e test and a CHANGELOG line), `info-buttons-for-help-text` (Sticker look, palette and info buttons shipped in 0.26.0 via #46). I verified this by CHANGELOG and file checks, not line by line.

``bash
git push origin --delete claude/new-session-ypxlqe
git push origin --delete claude/festive-newton-to6zx8
git push origin --delete claude/info-buttons-for-help-text
``

Never touch: any branch in section 2 with an open PR (#39, #47, #48, #51, #57, #71, #72).

## 2. Needs your decision

| PR / branch | What it is | Recommendation | Risk |
|---|---|---|---|
| #72 `claude/serene-johnson-n6f7j9` | Docs only: restores the "A blank screen" section of SYNC.md (1 file). Clean, 0 behind. Only failing check is Workers Builds, which fails on every PR branch. | **Merge** | Low. #57 also edits docs/SYNC.md. |
| #47 `claude/hopeful-noether-7bo41r` | 0.40.0: item-boosted stats as a green bar (Choice, Assault Vest). Clean, 0 behind, already merged the base. Its CI had not finished when checked. | **Merge** once CI and e2e are green | Low. Carries the next version number, so land it before #71. |
| #71 `claude/atlas-runtime-cache` | Atlas chunks cached on first use, not precached (precache 43.3 to 35.9 MB). CI green on its last head. | **Rebase**: re-bump after #47 (0.40.1) and fix the CHANGELOG conflict | Medium. It claims 0.39.3, which #68 already shipped; merging as is would duplicate the version. Offline behavior untested in a real browser. |
| #57 `claude/awesome-pasteur-d2o0pz` | "0.33.0": phone overflow fixes, device labels on saved teams, sync flush/abandon fixes. 67 behind, conflicts in 8 files (package/Cargo versions, CHANGELOG, TeamsDialog.tsx, sync/http.ts). | **Close**, re-cut the parts not already shipped (device labels, sync flush) on fresh branches | High if merged: 0.33.0 is already released (accounts groundwork); phone layout and sign-in fixes overlap #68. |
| #51 `claude/relaxed-mendel-texew2` | Threats: Mega holders at best forme, Tailwind toggles, multi-hit hit counts. 110 behind, 7 commits, conflicts in two threat views, version 0.27.0. | **Close**, re-do only what is missing | Medium. The Mega-holder part overlaps 0.28.0 (#52). |
| #48 `claude/confident-volta-nuyrak` | Outline-strength and brightness sliders; Reverse search start-from-an-idea cards. 114 behind, conflicts in 3 files, version 0.26.0. The idea cards are not on the default branch. | **Close**, or rebase if you still want the cards | Medium. |
| #39 `claude/spike-team-preview` (draft) | Roadmap item 15 spike, "stopped: no /samples". | **Keep** as a draft or close; it adds only a spike | Low. |
| `claude/ohko-report-details` (no PR) | OHKO report: per-move filter, full Pokémon list under Details, editable opponent builds. 71 behind, merges cleanly with the default branch, but it changes files. | **Rebase and open a PR** if the features are wanted, else delete | Medium: 71 commits stale; its changes are not shown to be on the default branch. |
| `claude/sweet-darwin-j8li6a` (no PR) | Disables pinch/double-tap zoom. Not on the default branch. | **Close**: blocking zoom hurts accessibility, and the PWA already passes axe tests | Low. |
| `claude/zen-hawking-2fz87l` (no PR) | 12 files: icon cache-busting, Meta tab fetch, mobile slot editor. The icon cache-busting and meta emit exist on the default branch; the slot editor rework was not checked. | **Close** after a quick look at the slot editor | Low. |

Local branch `local-snapshot-pre-sync` (5ecd7f7, 2026-09-27, local only, 353 behind): a snapshot of the old local folder. Keep until you are sure nothing in it is needed.

## 3. Roadmap status (ROADMAP-PROMPTS-v0.23.md, verified in code)

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Fix the stalled daily meta job | Shipped, 0.24.0 (#38) | `meta.yml` runs; schedule runs succeed (latest 2026-11-04 00:12 UTC); `meta.json` generatedAt 2026-11-04 |
| 2 | Repo hygiene, retire the artifact | Shipped, 0.24.0 | `docs/BRANCHES.md` exists; no `build:artifact` script or claude.ai references. Hygiene is incomplete in practice: 54 remote branches, 34 already merged |
| 3 | Security review of PR #37 (desktop pairing) | Shipped (code); review record not found | #37 merged 2026-10-06; hardening in 0.25.0 and 0.39.1 |
| 4 | Turn on cloud sync, migrations, health, backups | Shipped; live state inferred | `wrangler.jsonc` has the D1 binding (#50); `npm run deploy` applies migrations; `worker/health.ts` exists and `EXPECTED_MIGRATIONS` matches the 7 files in `migrations/`; weekly `d1-backup.yml` succeeds (last 2026-11-02) |
| 5 | Go private, trim Actions usage | **Partly shipped** | Updater serves `latest.json` 0.39.3 from the public releases repo and CI minutes are trimmed (paths-ignore, conditional WebKit). The main repository is **still public** |
| 6 | Champions data audit | Shipped, 0.24.0 | `scripts/audit-data.ts`, `dataAudit.ts`, `docs/data-audit.md`; weekly `data-audit.yml` succeeds (2026-11-02); no open or closed issues exist |
| 7 | Navigation: Analyse hub, palette, What's new | Shipped, 0.24.0 | `navigation.ts`, `AnalyseView`, `CommandPalette`, `WhatsNew` |
| 8 | Automatic archetype tags | Shipped, 0.24.0 | `archetypes.ts`, `archetypeInputs.ts`, `roles.ts` |
| 9 | Game-day mode | Shipped, 0.24.0 | `gameday.ts`, `gamedayStore.ts`, `GameDayView.tsx` |
| 10 | Benchmarks, team notes, team sheet | Shipped, 0.24.0 | `benchmarks.ts`, `benchmarkEval.ts`, `teamSheet.ts`, `TeamNotes`, `TeamSheet` |
| 11 | Meta trends | Shipped, 0.24.0 | `metaHistory.ts`, `scripts/meta/history.ts`, `useMetaHistory` |
| 12 | Tournament teams browser | Shipped, 0.24.0 | `tournamentTeams.ts`, `tournamentImport.ts`, `useTournamentTeams`, `scripts/meta/tournamentTeams.ts` |
| 13 | Complete my team | Shipped, 0.24.0 | `teamSuggest.ts`, `SuggestTeammate.tsx` |
| 14 | Pokénav data gaps (Gen 1 to 4) | Shipped as Atlas, 0.16.0 to 0.27.0; not compared with the prompt's gap list | `atlas-*.json` for every Gen 1 to 4 game, `scripts/atlas`, 22 files in `docs/data-gaps` |
| 15 | Optional team-preview spike | In progress, stalled | Draft PR #39, no sample screenshots |
| Match import, stages 1 to 3 | | **Not started / prompt not found** | No prompt in the repo, roadmap files or branches; no `matchImport` or Showdown-log code |

None of the shipped items was found to differ from its prompt at file level. I did not read each against its full acceptance list.

## 4. Problems found, most severe first

1. **Version collisions among open PRs.** #71 claims 0.39.3 (released by #68). #57 claims 0.33.0 (released), #51 0.27.0 and #48 0.26.0 (both long released), #47 claims 0.40.0. CI fails a PR with no CHANGELOG section for its version and the release workflow tags only the last bump, so merging these as is would break or duplicate releases.
2. **Stale PRs would revert newer work.** #57, #51 and #48 are 67 to 114 commits behind with conflicts in 2 to 8 files, and overlap shipped work (#68, #52).
3. **Default-branch e2e fails 3 tests on a Windows fresh clone** (`e2e/signin-return.spec.ts` lines 308, 360, 386: the blank-screen guard panel never appears). Unit (1,128), lint, typecheck and build pass; the same commit passes CI on Linux. Cause not determined; possibly line endings or the inlined boot guard on Windows.
4. **The repository is public** although roadmap item 5 and `docs/PRIVATE_REPO.md` describe it as private-capable. Intended or not is your call.
5. **Offline precache at 96%** (43.3 of 45 MB). #71 brings it to 80% but needs the rebase above. First load is 244 of 260 KB (94%), largest lazy chunk 276 of 320 KB (86%).
6. **Release bookkeeping gaps.** Versions with a CHANGELOG section but no tag and no release: 0.12.0, 0.17.0, 0.24.0, 0.32.0. Tags and releases with no CHANGELOG section: v0.8.0, v0.9.0, v0.9.1. CHANGELOG order is correct (36 sections, newest first); every version from 0.33.0 up has a tag and a release.
7. **`Workers Builds` fails on every PR branch** but succeeds on default-branch pushes since 0.39.2's fixes (it also failed on the earlier base commit). Probably non-production builds missing config; the log is not reachable from here.
8. **`npm run bump` fails on Windows** (CRLF `Cargo.lock` defeats its pattern) after already editing two files.
9. **Branch sprawl.** 54 remote branches besides the default; 34 merged and 7 more fully ported.
10. **Two stale workflow registrations** ("Web app deploy", "tmp node_modules") appear in GitHub's workflow list but have no file on the default branch.
11. **Minor.** One real TODO (`src/data/dex.ts:108`, emit `itemUser` from the data build). Every `npm run` script mentioned in README and CLAUDE.md exists. I did not do a dead-code scan; that would need a tool such as knip.

Checked and fine: lint, typecheck and unit tests on a fresh clone; the daily meta job (88 runs, latest successes today); the weekly D1 backup, data-audit and token-expiry workflows (all succeeding); the updater endpoint (`latest.json` 0.39.3, 7 platforms); zero open issues and no bot-created issues, ever.

## 5. Open PRs, mergeability (at audit time)

| PR | Mergeable | CI | Conflicts with default | Behind |
|---|---|---|---|---|
| #72 | yes (unstable: Workers Builds red) | none (docs only) | no | 0 |
| #71 | no | green | CHANGELOG.md | 3 |
| #57 | no | green | 8 files | 67 |
| #51 | no | green | 2 files | 110 |
| #48 | no | green | 3 files | 114 |
| #47 | yes (unstable) | not finished | no | 0 |
| #39 | draft | green | no | 148 |

## 6. Recommended next 5 sessions

1. Land the clean PRs: merge #72, get #47 green and merged, then rebase #71 as 0.40.1.
2. Housekeeping: delete the safe branches above, then close or re-scope #57, #51, #48, #39 and the three no-PR branches.
3. Re-cut what #57 had that is not shipped (device labels on saved teams, sync flush and hung-run abandon) as small fresh PRs.
4. Tooling and release hygiene: investigate the Windows e2e guard failures and the Workers Builds noise, fix `bump-version.mjs` for CRLF, backfill the missing tags, releases and CHANGELOG headings, drop the stale workflows.
5. Refresh the roadmap docs to match this table, then decide on the missing match-import prompt and the `ohko-report-details` branch.
