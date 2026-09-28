# iPhone / Android app (installable web app, auto-updating)

The app is also shipped as a PWA (Progressive Web App): open it once in the phone's browser, add it
to the home screen, and from then on it behaves like a native app — own icon, full screen, works
offline — without the App Store or an Apple developer account.

- `vite.config.ts` → `VitePWA(...)`: web manifest, and a service worker that precaches the whole
  app including every sprite atlas (~17 MB, downloaded once, then only what changed).
- `src/pwa.ts`: registers the service worker and checks for a new deploy on launch, every 30
  minutes, and whenever the app returns to the foreground. When one is found the page reloads
  itself onto the new version; teams are in localStorage, so nothing is lost.
- `public/icons/*`: home-screen icons, rendered from `src-assets/logo-source.png` by `npm run icons`.
- `public/splash/*`: iOS launch screens for every iPhone size since the SE, rendered from the same
  logo by `npm run splash` (the `<link rel="apple-touch-startup-image">` tags in `index.html` list
  them). They're left out of the service worker's precache; iOS fetches them once on install.
- Not active in the Tauri desktop shell (it has its own updater) nor in the single-file/artifact
  build (`--mode singlefile`).

## How the app adapts to the iPhone

- **Full screen, clear of the notch:** `viewport-fit=cover` with `env(safe-area-inset-*)` padding
  on the header, the bottom tab bar, bottom sheets and (in landscape) the page sides. Heights use
  `dvh`, so nothing hides behind Safari's toolbars or the home indicator.
- **Status bar:** `black-translucent` (white clock/battery over the app). In the light theme the
  header paints a dark band under it (`.status-band`) so the status bar stays readable.
- **Theme colour:** follows the theme picked in Settings (`src/App.tsx` updates `theme-color`).
- **Navigation:** a bottom tab bar (Build · Calc · Pokédex · More); every picker (Pokémon, item,
  move, ability) opens as a bottom sheet with its search box at the top, so the keyboard never
  covers it; dialogs are bottom sheets too.
- **Touch:** 44×44pt targets on touch screens (`pointer-coarse:` sizes and the `.hit` class for
  small icon buttons), no text selection or long-press callouts on controls, 16px text in every
  field (iOS zooms into anything smaller), info cards open on tap. Reordering a team is a press
  and hold (250 ms) so a swipe still scrolls.
- **Less on screen:** stats collapse to a one-line summary on phones, Champions' fixed level has
  no field, and a floating + button jumps to the next empty slot.

## What to check on a real iPhone

Automated checks run in Chromium with iPhone viewports (375×667, 390×844, 430×932); Safari itself
isn't available in CI. On a device, after **Add to Home Screen**:

1. Launch screen shows the logo on dark, then the app, with no white flash.
2. The clock and battery are readable in both themes; nothing sits under the notch / Dynamic
   Island or the home indicator, in portrait and landscape.
3. Tapping a picker opens the sheet with the keyboard up and the search box still visible;
   closing the keyboard doesn't leave a gap or jump the page.
4. Press-and-hold on a team sprite starts a reorder; a quick swipe scrolls instead.
5. Tapping an ⓘ opens its card, tapping elsewhere closes it.
6. No field zooms the page when focused.
7. Offline (Airplane mode): the app opens and every tab works; the Meta tab shows its offline
   notice.
8. After a new deploy, reopening the app switches to the new version by itself.

## Hosting: Cloudflare Workers + Cloudflare Access (private, free)

The repo is private and the app should only be reachable by people explicitly allowed in, so it
is hosted on Cloudflare (Workers static assets, builds private repos, redeploys on every push)
behind Cloudflare Access (login gate by e-mail, free up to 50 users). `wrangler.jsonc` tells
Cloudflare what to publish; the rest is configured in the Cloudflare dashboard.

### 1. Worker project (auto-deploy on push)

Workers & Pages → Create application → Import a repository → pick this repo, then:

- Production branch: the repo's default branch
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Environment variable `NODE_VERSION` = `22`

Every push to the production branch redeploys `https://pokemon-team-builder.<account>.workers.dev`
(Worker → Settings → Domains & Routes shows the exact URL). Per-version preview URLs are turned
off in `wrangler.jsonc` so they can't bypass the login. `public/_headers` (copied into `dist/`)
adds the security headers — a Content-Security-Policy matching the desktop app's, no framing,
no-sniff; if the app ever needs a new outside host, add it to that file's `connect-src`.

### 2. Restrict access to allowed people

1. Workers & Pages sidebar → **Set up Zero Trust** (free plan; asks for a team name).
2. Worker → Settings → Domains & Routes → the `workers.dev` entry → enable **Cloudflare Access**.
3. Zero Trust → Access → Applications → the application just created → Policies: Action
   **Allow**, Include → **Emails** → your address and each person you invite. Login method:
   **One-time PIN** (a code sent by e-mail; no accounts to create).
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
