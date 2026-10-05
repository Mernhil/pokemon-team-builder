# Making the repository private

Why: only two people use the app, and the repository ships game sprites and map art. What has to be
in place first, and what to check afterwards. Do it in this order.

## Before

1. **Desktop updates.** Set up the releases repository and secret, run the transition, and wait until
   every installed desktop app shows 0.24.0 or later (docs/DESKTOP_RELEASES.md → *Switching to the new
   endpoint*). Then remove the variable `MIRROR_RELEASES_TO_THIS_REPO`.
2. **Secrets I create by hand** (Settings → Secrets and variables → Actions, in this repository):

   | Name | What | Where it comes from |
   |---|---|---|
   | `RELEASES_REPO_TOKEN` | fine-grained token, Contents read/write on `pokemon-team-builder-releases` only | GitHub → Settings → Developer settings → Fine-grained tokens |
   | `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | update signing (already set) | docs/DESKTOP_RELEASES.md |
   | `LIMITLESS_API_KEY` | only if Limitless asks for a key (optional) | docs/UPDATING_META.md |
   | `D1_BACKUP_PASSPHRASE`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | database backups, once they exist | docs/SYNC.md |

3. **Actions minutes.** A private repository on the free plan gets about 2,000 minutes a month
   (Windows runners count double, macOS ten times). Measured on 5 October 2026 over the repository's
   nine days of history: CI used about 460 runner minutes (about 1,500 a month at that pace), the
   daily meta job under 1 minute a run, and a desktop release about 25 billed minutes (Linux 7, Windows
   8 × 2, checks 2). Releases are built only on a version bump, never on every push. The CI cuts in
   0.24.0 (docs-only changes skip CI, WebKit only for app changes, desktop project only after a
   merge) should bring CI to roughly 1,000 a month at the same pace. Watch Settings → Billing → Usage
   in the first weeks, and bump only when a feature is finished, not after every fix.

## The switch

4. GitHub → this repository → Settings → General → Danger Zone → **Change repository visibility** →
   Make private.

## After (check each one)

5. **Cloudflare Workers Builds** still has access to the repository: push any commit and watch the
   deploy start (Workers & Pages → pokemon-team-builder → Deployments). If it doesn't, Cloudflare
   dashboard → Workers & Pages → the project → Settings → Build → reconnect the GitHub app and grant it
   this repository.
6. **The daily meta workflow** still works: Actions → Meta data → Run workflow on the default branch.
   It commits to the default branch with the built-in token, which needs no setup on a private
   repository.
7. **Claude Code and the Cowork task "Champions regulation check"** still have the repository: run the
   task once by hand (or wait for Monday 08:48 Rome). If it says it can't clone or push, give its
   environment access to the repository (the Claude GitHub app → repository access).
8. **Links.** Everything that points at `github.com/Mernhil/pokemon-team-builder` for a visitor
   breaks for anyone not signed in as the owner. Remaining mentions (checked with
   `grep -rn github.com/Mernhil`): `docs/UPDATING_REGULATIONS.md` (the clone command, fine for you),
   `src-tauri/Cargo.toml`'s `repository` (metadata only), and `scripts/meta/http.ts`'s user agent
   (harmless). The in-app update link is the releases repository, which stays public.
9. **Desktop update check:** open the desktop app → the header's refresh button must say it is up to
   date (or offer the newest version), proving the public releases repository is reachable.
10. **PWA / phone app:** unaffected (Cloudflare serves it behind Access, not GitHub).

## Going back

Settings → General → Danger Zone → Make public. Nothing else depends on the visibility except what is
listed above.
