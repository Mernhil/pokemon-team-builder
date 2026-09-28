# Desktop releases (Windows/Linux, with auto-update)

The app ships as a Tauri desktop app. `.github/workflows/desktop-release.yml` builds native
installers on each OS's own GitHub-hosted runner and, on a version tag, publishes them to a
GitHub Release together with a signed `latest.json` — that's what the in-app "Install & Restart"
banner (`src/components/DesktopUpdater.tsx`) checks on launch, every 4 hours while the app is open,
and on demand from the header's refresh button (which also flags a failed background check).

The updater downloads `latest.json` and the installers **without authentication**, so the
repository (or wherever releases are published) must be **public** — on a private repo GitHub
answers 404 and no update is ever found.

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

1. Bump the version everywhere at once (tauri.conf.json, Cargo.toml/.lock, package.json/-lock) and
   add a `## <version> — <date>` section to `CHANGELOG.md` (the workflow uses it as the release text):
   ```bash
   npm run bump -- 0.6.0
   ```
2. Run `npm run typecheck && npm test`, commit, and push it to the branch you'll release from
   (normally the default branch).
3. Publish the release — either:
   - **GitHub web:** Releases → **Draft a new release** → *Choose a tag* → type `v0.6.0` →
     *Create new tag on publish* → set **Target** to the branch from step 2 → add notes (or
     *Generate release notes*) → **Publish release**; or
   - **CLI:** `git tag v0.6.0 && git push origin v0.6.0`.
4. The workflow first checks that the tag matches the version from step 1 (a mismatch fails the run
   before anything is built or uploaded) and that typecheck + tests pass, then builds both
   platforms and attaches the installers and `latest.json` to that tag's **public** Release (creating
   it when the tag was pushed from the CLI). Watch it under the Actions tab; the assets appear on the
   release after ~15–20 minutes. Apps already installed will offer the update next time they're
   launched (already-running instances: at the next 4-hourly check, or right away from the header's
   "Check for updates" button).

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
  tag it, and installed apps update to the fixed build. To stop a broken release spreading before
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
