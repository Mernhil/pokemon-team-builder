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

## Hosting: Cloudflare Pages + Cloudflare Access (private, free)

The repo is private and the app should only be reachable by people explicitly allowed in, so it
is hosted on Cloudflare Pages (builds private repos, redeploys on every push) behind Cloudflare
Access (login gate by e-mail, free up to 50 users). Both are configured in the Cloudflare
dashboard; there is no workflow in this repo.

### 1. Pages project (auto-deploy on push)

Workers & Pages → Create → Pages → Connect to Git → pick this repo, then:

- Production branch: the repo's default branch
- Build command: `npm run build`
- Build output directory: `dist`
- Environment variable `NODE_VERSION` = `22`

Every push to the production branch redeploys `https://<project>.pages.dev`.

### 2. Restrict access to allowed people

1. Pages project → Settings → General → **Access policy** → Enable. This protects the preview
   deployments (`*.<project>.pages.dev`) and creates a Zero Trust Access application.
2. Zero Trust → Access → Applications → that application → edit it and **also add the production
   hostname** `<project>.pages.dev` (step 1 alone leaves production public).
3. Policy: Action **Allow**, Include → **Emails** → your address and each person you invite.
   Login method: **One-time PIN** (a code sent by e-mail; no accounts to create).
4. Session duration: a long one (e.g. 1 month) so the phone app doesn't ask to log in often.

To grant or revoke someone, add/remove their e-mail in the policy. Check it by opening the URL in a
private window: it must show the Cloudflare login page, not the app.

### How login interacts with the installed app

- The first launch shows the Cloudflare login page (e-mail → PIN), then the app.
- Once cached, the app opens offline without logging in (it's already on the phone).
- Update checks run with the login cookie. If the session has expired the check quietly fails
  and the app keeps the version it has; the next time the login page shows up and you log in,
  it updates.

## Installing on iPhone

1. Open the site URL in **Safari** (other iOS browsers can't install web apps on older iOS).
2. Share button → **Add to Home Screen** → Add.
3. Open it once while online so everything is cached; after that it also works offline.

Android (Chrome): menu ⋮ → **Install app** / **Add to Home screen**.

## Updates

Nothing to do on the phone: push to the default branch, wait for the Cloudflare deploy (~1–2 minutes), and the
next time the app is opened or brought back to the foreground it reloads onto the new version.
