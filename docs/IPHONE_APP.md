# iPhone / Android app (installable web app, auto-updating)

The app is also shipped as a PWA (Progressive Web App): open it once in the phone's browser, add it
to the home screen, and from then on it behaves like a native app — own icon, full screen, works
offline — without the App Store or an Apple developer account.

- `vite.config.ts` → `VitePWA(...)`: web manifest, and a service worker that precaches the whole
  app including every sprite atlas (~17 MB, downloaded once, then only what changed).
- `src/pwa.ts`: registers the service worker and checks for a new deploy on launch, every 30
  minutes, and whenever the app returns to the foreground. When one is found the page reloads
  itself onto the new version; teams are in localStorage, so nothing is lost.
- `public/icons/*`: home-screen icons, rendered from `public/favicon.svg` by `npm run icons`.
- Not active in the Tauri desktop shell (it has its own updater) nor in the single-file/artifact
  build (`--mode singlefile`).

## Hosting: GitHub Pages (automatic on every push)

`.github/workflows/web-deploy.yml` builds, tests and deploys `dist/` on every push to the default
branch. One-time setup:

1. GitHub Pages is free only for **public** repositories (a private repo needs a paid plan).
   Either make the repo public (Settings → General → Danger Zone → Change visibility) or use one
   of the alternatives below. Nothing secret is committed: `src-tauri/updater.key.pub` is the
   public half; the signing key lives only in Actions secrets.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Push to the default branch (or Actions → Web app deploy → Run workflow). The URL is shown in
   the run summary, normally `https://<user>.github.io/pokemon-team-builder/`.

### Alternative for a private repo: Cloudflare Pages or Netlify (free)

Both can build private repos and redeploy on every push by themselves — no workflow needed.
Connect the GitHub repo in their dashboard with:

- Build command: `npm run build`
- Output directory: `dist`
- Production branch: the repo's default branch
- Environment variable `NODE_VERSION` = `22`

If you go this way, delete `.github/workflows/web-deploy.yml` so it doesn't fail on every push.

## Installing on iPhone

1. Open the site URL in **Safari** (other iOS browsers can't install web apps on older iOS).
2. Share button → **Add to Home Screen** → Add.
3. Open it once while online so everything is cached; after that it also works offline.

Android (Chrome): menu ⋮ → **Install app** / **Add to Home screen**.

## Updates

Nothing to do on the phone: push to the default branch, wait for the deploy (~1 minute), and the
next time the app is opened or brought back to the foreground it reloads onto the new version.
