# Desktop releases (Windows/Linux, with auto-update)

The app ships as a Tauri desktop app. `.github/workflows/desktop-release.yml` builds native
installers on each OS's own GitHub-hosted runner and, for each new version, publishes them to a
GitHub Release together with a signed `latest.json` — that's what the in-app "Install & Restart"
banner (`src/components/DesktopUpdater.tsx`) checks on launch, every 4 hours while the app is open,
and on demand from the header's refresh button (which also flags a failed background check).

The updater downloads `latest.json` and the installers **without authentication**, so wherever
releases are published must be **public** — on a private repo GitHub answers 404 and no update is
ever found. That is why releases are published to a **separate public repository**,
`Mernhil/pokemon-team-builder-releases` (it holds only the Releases, no code), and the app's own
repository can be private (docs/PRIVATE_REPO.md). `src-tauri/tauri.conf.json`'s updater endpoint is
`https://github.com/Mernhil/pokemon-team-builder-releases/releases/latest/download/latest.json`.

## One-time setup: the releases repository

1. Create a **public** repository `Mernhil/pokemon-team-builder-releases` with a README (it needs one
   commit, so releases can create their tags).
2. Create a **fine-grained personal access token** (GitHub → Settings → Developer settings →
   Personal access tokens → Fine-grained): resource owner `Mernhil`, *Only select repositories* →
   `pokemon-team-builder-releases`, permission **Contents: Read and write**, nothing else, an
   expiry you will remember (renew it before it runs out: releases fail with "Bad credentials"
   otherwise).
3. In this repository: Settings → Secrets and variables → Actions → New repository secret
   `RELEASES_REPO_TOKEN` = that token.
4. Settings → Secrets and variables → Actions → **Variables** → New repository variable
   `MIRROR_RELEASES_TO_THIS_REPO` = `true` (the transition below).

The `verify` job refuses to build a release while `RELEASES_REPO_TOKEN` is missing.

**The token expires** (90 days if you kept the default). `.github/workflows/token-expiry.yml` reads its
expiry date daily (GitHub returns it in a response header) and, with 14 days or fewer left, opens one
issue, "Renew the releases token", and comments on it every day; with 7 days or fewer left, or a dead
token, the run also fails so GitHub e-mails you. To renew: make a new token as in step 2 and replace the
secret `RELEASES_REPO_TOKEN`; the issue closes itself at the next check. Run it by hand from Actions →
*Releases token expiry* → Run workflow.

## Switching to the new endpoint (transition)

Installed apps look at the endpoint that was built into *them*, so the first release that carries
the new endpoint has to be published where the old apps look too:

1. With the repository **still public**, do the one-time setup above (variable included), merge the
   change that carries the new endpoint (version 0.24.0) and let the release run. It builds once,
   publishes to the releases repository, then the `publish` job copies the release (installers and
   `latest.json`) into this repository's Releases as well.
2. Open each installed desktop app once: it finds 0.24.0 through the old endpoint, installs it and
   restarts. Settings & credits shows the version. From now on that app looks at the releases
   repository.
3. When **every** installed app shows 0.24.0 (or later), delete the variable
   `MIRROR_RELEASES_TO_THIS_REPO` (or set it to anything but `true`) and then make the repository
   private (docs/PRIVATE_REPO.md). An app still on 0.23.0 or older would never see another update
   after that; fix it by installing the newest installer from the releases repository by hand.

## One-time setup: signing secrets

The updater refuses to install anything that isn't signed with this project's key
(`src-tauri/updater.key.pub`, already committed and wired into `tauri.conf.json`). The matching
private key was generated once and must never be committed; it lives only as a GitHub Actions
secret so CI can sign releases.

Settings → Secrets and variables → Actions → **New repository secret**, add both:

- `TAURI_SIGNING_PRIVATE_KEY` — the private key content
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password chosen for it

(Whoever set up this repo has these two values — ask them, or regenerate a new pair with
`npx tauri signer generate -w src-tauri/updater.key` if they were lost; that also means updating
the `pubkey` field in `src-tauri/tauri.conf.json`, since old and new keys aren't interchangeable.)

Until these secrets are set, tag-triggered builds still run but fail at the signing step — the
installers themselves build fine, only the auto-updater manifest can't be produced.

## Cutting a release

The release happens by itself once a version bump is merged: **bump → CHANGELOG → PR → merge → release.**

1. Bump the version everywhere at once (tauri.conf.json, Cargo.toml/.lock, package.json/-lock) and
   add a `## <version> — <date>` section to `CHANGELOG.md` (the workflow uses it as the release text):
   ```bash
   npm run bump -- 0.6.0
   ```
2. Run `npm run typecheck && npm test`, commit, and open a PR into the default branch
   (`claude/pokemon-team-builder-otextg`).
3. Merge the PR. The push to the default branch changes `package.json`, which starts
   `desktop-release.yml`. Its `plan` job reads the version; if `v<version>` doesn't exist as a tag yet,
   the release runs for it, and the `publish` job creates the tag at the merged commit. If the tag
   already exists (e.g. a `package.json` edit that didn't bump the version, or a re-push after a
   release) nothing happens.
4. The workflow first checks that the tag matches the version from step 1 (a mismatch fails the run
   before anything is built or uploaded) and that typecheck + tests pass, then builds both
   platforms and attaches the installers and `latest.json` to that tag's Release in the **public
   releases repository**. Watch it
   under the Actions tab; the assets appear on the release after ~15–20 minutes. Apps already
   installed will offer the update next time they're launched (already-running instances: at the next
   4-hourly check, or right away from the header's "Check for updates" button).

Tagging by hand still works and does the same thing: push `vX.Y.Z` (`git tag v0.6.0 && git push origin v0.6.0`)
or publish it from GitHub's web UI (Releases → **Draft a new release** → new tag → **Publish**), with the
version bump already on that commit. Don't do both for one version: if the merge's run has already
created the tag, the manual tag push is a no-op; if you tag first, the merge's run sees the tag and skips.
(The tag has to exist *before* the merge's `plan` job looks, so tag only before merging or after the
release has finished.)

If a run fails after the release was published, fix the cause, then delete the release **and** its
tag on GitHub and publish it again (or bump to the next patch version).

## Rolling back a bad release

- **Web / iPhone app:** revert the release's merge on the default branch (`git revert -m 1 <merge>`) and
  push; Cloudflare redeploys in 1–2 minutes and installed apps pick it up on their next open.
  Cloudflare's dashboard (Workers → Deployments → *Rollback*) restores the previous deploy instantly
  if a revert can't wait. Saved data after rolling 0.7.0 back to 0.6.x: teams, folders and variations
  load as they are; the match log's newer save format (v2) isn't read by 0.6.x, which shows an empty
  log but leaves the save alone until a match is logged — and the pre-0.7.0 copies are kept in the
  browser (`ptb:v1:backup-v2` for teams, `ptb:matches:v1:backup-v1` for matches) to restore by hand.
- **Desktop:** the updater only moves forward (it installs a *higher* version), so don't delete the
  release people already have. Fix forward: revert on the default branch, `npm run bump -- <next patch>`,
  merge it (the release runs by itself), and installed apps update to the fixed build. To stop a broken release spreading before
  that's ready, mark its GitHub Release as a draft: `latest.json` then 404s and apps stay where they are.

## Manual test build (no release, no signing needed)

GitHub → Actions tab → "Desktop release" → **Run workflow** (no tag needed). This just builds the
installers on Windows and Linux and attaches them to that run (Summary tab → Artifacts) — useful to
confirm the pipeline still builds before secrets are configured, or to grab an unsigned build to
test manually.

## Local build

```bash
npm install
npm run desktop:build       # runs `tauri build`; installer lands in src-tauri/target/release/bundle/
```

Needs a Rust toolchain (rustup.rs) and, on Linux, `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev
patchelf libayatana-appindicator3-dev`. Windows needs nothing extra beyond Rust + Node. macOS isn't a release target (phones and
Macs can use the web app — see IPHONE_APP.md).
