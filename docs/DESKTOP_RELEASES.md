# Desktop releases (Windows/macOS/Linux, with auto-update)

The app ships as a Tauri desktop app. `.github/workflows/desktop-release.yml` builds native
installers on each OS's own GitHub-hosted runner and, on a version tag, publishes them to a
GitHub Release together with a signed `latest.json` — that's what the in-app "Install & Restart"
banner (`src/components/DesktopUpdater.tsx`) polls on launch.

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

1. Bump the version in **both** `src-tauri/tauri.conf.json` (`"version"`) and
   `src-tauri/Cargo.toml` (`[package] version`) — keep them equal.
2. Commit that on `main`.
3. Tag and push:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
4. The workflow builds all three platforms and publishes a **public** GitHub Release named after
   the tag, with the installers and `latest.json` attached. Apps already installed will offer the
   update next time they're launched (or already-running instances, next periodic check).

## Manual test build (no release, no signing needed)

GitHub → Actions tab → "Desktop release" → **Run workflow** (no tag needed). This just builds the
installers on all three OSes and attaches them to that run (Summary tab → Artifacts) — useful to
confirm the pipeline still builds before secrets are configured, or to grab an unsigned build to
test manually.

## Local build

```bash
npm install
npm run desktop:build       # runs `tauri build`; installer lands in src-tauri/target/release/bundle/
```

Needs a Rust toolchain (rustup.rs) and, on Linux, `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev
patchelf libayatana-appindicator3-dev`. Windows and macOS need nothing extra beyond Rust + Node.
