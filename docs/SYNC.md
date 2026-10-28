# Cloud sync (web app and phone app)

Syncs your **teams** (with their folders and variations) and your **match log** across the devices you
use the web app on, through the Cloudflare deployment that already hosts it (docs/IPHONE_APP.md). It is
opt-in (Settings → Sync), the app stays offline-first (localStorage is always the source of truth), and
nothing else is synced: not the theme, picker favourites or calculator state.

## How it works

- `worker/` is a Worker that answers `/api/*` only. `wrangler.jsonc` sets `assets.run_worker_first: ["/api/*"]`, so every other request is served from the static assets exactly as before.
- **Identity** is the e-mail inside the `Cf-Access-Jwt-Assertion` header that Cloudflare Access adds. `worker/auth.ts` verifies its RS256 signature against the Access team's keys (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`), then the issuer, the audience (`ACCESS_AUD`) and the expiry. A plain e-mail header is never trusted.
- **Storage** is one D1 table, `documents` (`migrations/0001_init.sql`): one row per account and document (a team or a match), with a tombstone row (`deleted = 1`) for deletes and a per-account `server_seq` that is the sync cursor.
- **Endpoints:** `GET /api/sync?since=<seq>` (documents after a cursor, paged) and `POST /api/sync` (up to 100 documents). Every payload is validated with zod (`src/domain/syncProtocol.ts`), is limited in size (64 KB per document, 1 MB per request), and each team or match goes through the same sanitisers the app loads its own data with before it is stored. A document stamped more than 10 minutes in the future is refused (a wrong clock would win every conflict). `GET /api/session/renew` (re-login, below) and `GET /api/health` (setup check, below) sit behind Access like the rest.
- **Merge rule** (`src/domain/sync.ts`): last write wins per document by `updatedAt`, a delete is just another version. When both sides changed a team since the last sync, the losing version is kept as a variation labelled **Conflict copy (<device>, <date>)**; matches follow the same rule without copies. Clocks within 5 seconds of each other are treated as a tie (the server's version wins and the other is kept as a copy), and an edit beats a delete unless the delete is clearly later.
- **Client** (`src/sync/`): syncs when it starts, when the window regains focus or the app comes back to the foreground, when the connection returns (`online`), every 3 minutes while the app is visible, 5 seconds after teams or matches change, and on "Sync now". After a network failure (offline, or a server error) it retries after 10 s, 30 s and 2 min (`retry.ts`), and does not retry a sign-in or setup problem. A run pulls first, merges and saves the new state, and only then pushes (`engine.ts`), so a failure at any point loses neither local edits nor what was pulled; the next run sends what is still unsent. The first sync on a new device merges with what is already there (nothing is wiped). The code loads only once sync is on.

The web app and the phone app sync through Cloudflare Access. The Tauri desktop app can't pass Access, so it is **linked with a pairing code** (below).

## One-time setup (by hand)

Until the steps below are done the app works exactly as before and `/api/sync` answers `501 sync is not set up`. The answer lists what is missing (`{"missing": ["DB", "ACCESS_AUD"]}`) and Settings → Sync shows it in words, e.g. “the D1 database isn’t bound (steps 1–3)”.

1. **Create the D1 database** (Cloudflare dashboard → Workers & Pages → D1 → Create database, or `npx wrangler d1 create pokemon-team-builder`). Copy its **database id**.
2. **Bind it** in `wrangler.jsonc`: uncomment the `d1_databases` line at the bottom and paste the id (and add the comma shown on the line above it). Commit and push; Workers Builds redeploys.
3. **Apply the migrations**: `npx wrangler d1 migrations apply pokemon-team-builder --remote` applies every file in `migrations/` that hasn't run yet (0001 creates the documents table, 0002 adds sharing and a `group_id` column, 0003 adds linked devices, 0004 the redeem throttle). Once the deploy command below is set, every deploy does this by itself, **before** the new code goes live (the sync code of a version that adds a migration needs it: for example 0002's `group_id`). By hand, or pasting the files into the D1 console in order, also works.
4. **Find the Access values.** Zero Trust → Settings → Custom pages shows the team domain (`<team>.cloudflareaccess.com`). Zero Trust → Access → Applications → the app's application → Overview → **Application Audience (AUD) Tag**.
5. **Set the two variables** on the Worker: Workers & Pages → pokemon-team-builder → Settings → Variables and Secrets → add `ACCESS_TEAM_DOMAIN` (e.g. `myteam.cloudflareaccess.com`) and `ACCESS_AUD` (the tag). `keep_vars` in `wrangler.jsonc` stops deploys from removing them.
6. **Make Access cover `/api/*`.** The Access application protects the Worker's whole hostname (docs/IPHONE_APP.md step 2), so `/api/*` is already behind the login. If you used a path-limited application, add `/api/*` to it. Check: opening `https://<worker>/api/sync` in a private window must show the Access login, not JSON.
7. **Set the deploy command** (below), so migrations are applied on every deploy.
8. **Set the Access session duration** to 1 month (see *Sign-in expired*).
9. In the app: Settings → Sync → **Sync with my account**.

### Deploy command (migrations on every deploy)

`npm run deploy` is `npx wrangler d1 migrations apply pokemon-team-builder --remote && npx wrangler deploy`: the migrations first, and the deploy only if they worked (an unapplied migration can never be live with the code that needs it; applying one is a no-op when nothing is new). Workers Builds runs it once you set it:

1. Cloudflare dashboard → Workers & Pages → **pokemon-team-builder** → **Settings** → **Build** (Builds).
2. **Build command**: `npm run build` (unchanged).
3. **Deploy command**: change `npx wrangler deploy` to `npm run deploy`. Save.
4. The build's API token needs permission to edit D1: in the same Build settings, *API token* → the token must include **D1: Edit** (Account → D1 → Edit) next to Workers Scripts. If the first build then fails with an authentication error on the migrations step, edit that token (My Profile → API Tokens, or the build's token link) and add the permission.
5. Push (or **Retry build**) and check the build log: *No migrations to apply!* or the list it applied, then the deploy.

Settings → Sync shows one line from `GET /api/health` so you can see the result without a terminal: *Server ready*, *Database migration missing: 0004*, *Database not bound…*, or which `ACCESS_*` variable is missing. The endpoint is behind Access, answers booleans, the migration names and the server time, and nothing about any account (`worker/health.ts`; the expected list is `EXPECTED_MIGRATIONS` in `src/domain/syncHealth.ts`, kept in step with `migrations/` by a test: **add a name there with every new migration**).

## Sign-in expired

Access signs you out after the session duration. On a phone this used to be a trap: the installed app is the cached app, so a reload never reached Access, and the only way out was signing in on the website and re-adding the app. Now:

1. **Navigations to `/api/*` and `/cdn-cgi/*` skip the cache.** The service worker (`sw/sw.ts`, the paths in `NETWORK_ONLY_PATHS` of `src/domain/swGuard.ts`) leaves them to the network; everything else is the cached app. `/cdn-cgi/` is Cloudflare's: after the Access login the browser comes back through `https://<app>/cdn-cgi/access/callback?code=…&state=…`, a navigation on the app's own address. Until 0.39.2 only `/api/` was on the list, so the worker answered the callback with the cached `index.html`: the request never reached Access (no `CF_Authorization` cookie), the app opened at that address, its relative `./assets/…` URLs resolved to `/cdn-cgi/access/assets/…` (nothing there) and the page stayed black (below).
2. **Expiry is noticed and shown.** A 401/403 or Access's redirect to its login page becomes a `signin` error (`src/sync/http.ts`; `syncStore.lastErrorKind` is `signin` | `offline` | `setup` | `other`). A banner at the top of the app says *Your sign-in has expired. Tap Sign in again.* (dismissible; it comes back with the next new failure), the header sync light turns red, and Settings → Sync shows the same message with the button. Other errors show a *Sync problem* chip that opens Settings → Sync; Settings has the diagnostics.
3. **Sign in again** sets `location.href = '/api/session/renew'` (never `window.open`, which on iOS opens Safari, whose cookie the home-screen app can't use). Access shows its login inside the app's own window, the cookie lands where the app can use it, and the Worker answers `GET /api/session/renew` (it needs a valid Access JWT, otherwise 401) with `302 /`. The app reloads signed in and sync resumes by itself. Local data is never touched: edits made while signed out are sent afterwards.
4. **Access must stay in front of `/api/session/renew`**: it is covered by the same application as the rest of the hostname (do not add it to a bypass). Check from a private window: `https://<worker>/api/session/renew` shows the Access login, not a redirect to the app.
5. The desktop app has no Access login: when its device is unlinked the banner says so and opens Settings → Sync to link it again with a pairing code.

## A blank screen

Since 0.39.2 `index.html` carries a small inline script (`src/bootGuard.js`, outside the bundle, allowed by a hash the build adds to the CSP in `dist/_headers`). If the entry script fails to load, or `#root` is still empty after 8 seconds, it covers the screen with a plain message and three buttons: **Reload**, **Reset app cache** (unregisters the service workers and deletes the caches; never `localStorage` or IndexedDB, where the teams and matches are) and **Sign in again** (`/api/session/renew`). It goes away by itself if the app draws after all.

**The service worker (`sw/sw.ts`) never keeps a bad answer.** Its precache downloads use `redirect: 'error'` and `cache: 'reload'`, and a file is stored only if `checkPrecacheResponse` (`src/domain/swGuard.ts`) accepts it: status 200, not redirected, a content type that fits the extension (never a web page for a script, stylesheet or data file), and `index.html` must contain the app's `#root`. Behind Access (or the single-page-app fallback) a missing file can come back as a login redirect or `index.html` with a 200, and Workbox keys a hashed file by its URL and never downloads it again. Any refused file fails the whole install, so the running version and its precache stay exactly as they were and the next check retries; entries an older worker stored from a bad answer are dropped and downloaded again at the next install. Test: `e2e/signin-return.spec.ts` (a stand-in for Access, `e2e/support/accessSim.ts`).

**How a phone that is already stuck gets the fix.** It is served by the old service worker, which swallows the callback, so the phone can never log in, and it cannot download the new worker either: while the Access cookie is missing `/sw.js` answers with a redirect to the login and the update fails (“the script resource is behind a redirect”). The fix reaches a phone by itself only while it still has a valid Access session: opening the app (or bringing it to the foreground) checks for a new deploy, installs it and reloads. By hand, on a phone that is already black:

1. *Sure way:* delete the app from the home screen, open the site in Safari, sign in, **Share → Add to Home Screen** again. That drops the old worker and caches, and also this app's `localStorage` (iOS keeps a home-screen app's data apart from Safari's): teams and matches that were synced come back at the first sync (Settings → Sync on), whatever was only on the phone is lost. Back up first from a phone that still works, if you have one (Team actions → export).
2. *Without losing local data (not tried on a phone):* in Zero Trust → Access → Applications → this application, add a **Bypass → Everyone** policy for a few minutes, open the installed app once (it downloads the new worker without a login and reloads), close it, remove the bypass, and use **Sign in again**. While the bypass is on, anyone can download the app's files (not your data: `/api/*` checks the Access token itself).
3. A phone that is black *and* sits on a `/cdn-cgi/…` address after a relaunch is the same state: use 1 or 2.

**Set the session duration (by hand).** Zero Trust → Access → Applications → the application → **Edit** → **Basic information** (or *Settings*) → **Session duration** → **1 month**; Save. Also check Zero Trust → Settings → Authentication → **Global session timeout**, which can cap it. A longer session means fewer expiries; it does not remove them.

**Manual test on the iPhone app.**
1. Settings → Sync on; wait for the green dot.
2. Expire the session: Zero Trust → Access → *Users* (Zero Trust → Team & Resources → Devices/Users) → your user → **Revoke session** (or set a 5-minute session duration, wait, and set it back to 1 month).
3. Bring the app to the foreground or tap **Sync now**: the red banner *Your sign-in has expired. Tap Sign in again.* appears and the header dot is red. Edit a team meanwhile.
4. Tap **Sign in again**: the Access login (e-mail → code) shows inside the app, then the app comes back.
5. The dot turns green, Settings → Sync says *Last synced just now*, and the edit made in step 3 shows on the website's copy after its next sync.

## Sharing (two players)

Built on the same Worker, D1 database and Access identity. Nothing is shared unless the owner does it, and every read and write is checked on the server.

- **Shared folders.** In Saved teams, a team's share button (visible once sync is on) shares that team **and all its variations** with one e-mail address as *can view* or *can edit*. The server needs the team to have synced once (the dialog syncs first). Only a top-level team can be shared, never a single variation.
- **What the other person gets.** A "Shared with me" section in Saved teams, with the owner's name on each tile (their display name, or their e-mail). A view-only team opens in the builder read-only (every edit is refused with a notice) with **Make my own copy**, which copies the folder into their own teams. With *can edit* they can change the team, edit and add variations; they cannot delete the top-level team. Their edits go to the owner's copy and show up in the owner's own sync.
- **Conflicts.** The same merge rule as for one person's devices (`src/domain/sync.ts`): last write wins by `updatedAt`, and when both changed a team the version that loses is kept. For shared teams the loser is kept as a **team of the editor's own** (named "… (conflict copy (<device>, <date>))"), so nothing is lost on either side.
- **Match log.** Settings → Sync → Sharing → *Share my matches* gives one person a read-only copy of your whole match log. Their matches show up in the Match log and Meta tabs as a separate choice (*Mine / <Name>'s / Both of us*) and only count in your statistics when you pick *Both of us*.
- **Notices.** When a sync brings in a change by the other person you get a toast ("Ash updated “Rain M-C” 2 h ago.", at most three, nothing older than a week). Set your **display name** in Settings → Sync. There are no push notifications.
- **Ending it.** The owner can stop sharing at any time (Share dialog → Stop sharing, or Settings); the other person can also *Leave*. The shared copies disappear from the other person's devices at their next sync; anything they copied with *Make my own copy* is theirs.

### How it is stored and checked

- `migrations/0002_shares.sql`: `shares` (owner, grantee, kind `team-group` | `matches`, ref, role), `profiles` (display names) and a `group_id` column on `documents` (a team's folder: its own id, or its `groupId`).
- Endpoints: `GET /api/shares`, `PUT /api/shares`, `DELETE /api/shares` (the owner stops sharing, or the grantee leaves), `PUT /api/profile`, `GET /api/shared` (everything shared with me, tombstones included) and `POST /api/shared` (edits to folders I can edit).
- `worker/access.ts` is the whole access matrix as one pure function (owner / editor / viewer / stranger; matches are never writable by anyone but their owner). `POST /api/shared` additionally refuses to move a team into or out of a folder, to touch another folder, to delete a folder's top-level team, and never stores the client-side `shared` marker.
- At most 50 shares per account; a share needs a valid e-mail address, and the address must be one that Access lets in (the share itself doesn't invite anyone).

## Backing up D1

- Export: `npx wrangler d1 export pokemon-team-builder --remote --output backup.sql` (add `--no-schema` for data only).
- Weekly, automatically: `.github/workflows/d1-backup.yml` (Mondays, and *Run workflow* by hand) exports the database, encrypts it with `age` to the `AGE_PUBLIC_KEY` secret and keeps it as a private artifact for 30 days. It needs the secrets `CLOUDFLARE_API_TOKEN` (D1: Read) and `AGE_PUBLIC_KEY`; without them it only warns. Restore: `age -d -i key.txt -o backup.sql backup-….sql.age`, then `npx wrangler d1 execute pokemon-team-builder --remote --file backup.sql` into an empty database.
- D1 also keeps Time Travel restore points for 30 days: `npx wrangler d1 time-travel info pokemon-team-builder`, then `... restore ... --timestamp=<time>`.
- The app itself is a backup too: each device keeps a full copy in localStorage, and Import / Export → JSON backup still works.
- Tombstones (deleted documents) are kept forever and are tiny. To prune old ones: `DELETE FROM documents WHERE deleted = 1 AND updated_at < <ms>`; a device that hasn't synced since then could bring a deleted document back.

## Turning sync off and keeping your data

Settings → Sync → untick **Sync with my account**. Everything on the device stays exactly as it is; it just stops sending and receiving. Your documents stay on the server until you delete them there (`DELETE FROM documents WHERE owner = '<your e-mail>'`). Turning it on again later merges (it doesn't wipe either side).

## Linking the desktop app (pairing code)

The desktop app has no Access login, so the phone (or the website) vouches for it:

1. In the phone/web app: Settings → Sync → **Make a pairing code**. It shows `ABCDE-FGHJK` (10 symbols, 50 bits, valid 10 minutes, single use) and a **Copy link** button (`https://<worker>/#pair=ABCDE-FGHJK`, server and code in one).
2. In the desktop app: Settings → Sync → paste the link (or type the server address and the code) → **Link this desktop app**. The app trades the code for a **device token** and turns sync on. From then on it syncs exactly like the web app (teams, match log, sharing).
3. The phone's Settings → Sync lists the linked desktop apps; **Unlink** revokes one at once (its next request gets 401 and Settings says to link again). The desktop can also unlink itself.

How it works:
- `migrations/0003_devices.sql`: `pair_codes` and `devices`. Only SHA-256 hashes are stored (of the code, of the token). A code is deleted when it is redeemed (one statement, so two requests can't both win) or when it expires; an account keeps at most 5 live codes and 10 linked devices.
- `POST /api/pair`, `GET`/`DELETE /api/devices`: behind Access, for the signed-in account.
- `/api/device/*` is what the desktop calls: `POST /api/device/redeem` (code → token, no auth) and the same `sync`, `shared`, `shares`, `profile` routes as bearer-token requests (`Authorization: Bearer ptbd_…`), plus `DELETE /api/device/self`. A device token acts for the one account that made its code. It can **not** create codes or list/revoke other devices. CORS answers only the desktop webview's origins.
- **Tokens.** 32 random bytes; only the SHA-256 is stored, the token is returned once (the redeem answer), never listed again, never put in a URL (an `Authorization` header only) and never logged (the Worker logs nothing of requests). The desktop app keeps it in its local storage (`ptb:device:v1`), like the rest of its data, **not in the OS keychain**. The trade-off: anything that can read the app's data folder as the same user can read the token and act as that device until it is unlinked, while the teams stored next to it are readable anyway. A keychain would protect only the token, not the teams; the token is revocable (a lost laptop is one tap on the phone), so the keychain was left out. If you want it, a Tauri secure-storage plugin is the place.
- **Throttle.** `POST /api/device/redeem` allows 10 attempts per client address per 10 minutes (`redeem_attempts`, migration 0004: a hash of the address and a counter; the address comes from Cloudflare's `CF-Connecting-IP`), then answers 429. Every attempt counts, right or wrong. Guessing is hopeless anyway (50 bits, 10 minutes, at most 5 live codes per account); this stops it being tried at all. A D1 counter was chosen over a Cloudflare rate-limiting rule because it works from the first deploy, needs no dashboard step and is covered by tests; add a rule as well if you like.
- **Limits.** At most 5 live codes and 10 linked devices per account, both enforced in the Worker (the device limit in the same statement that inserts the device, so simultaneous redeems can't pass it). A code is consumed even when the device limit refuses it. Unlinking is immediate: every request looks the token up in D1, so the next one gets 401.
- **Turning sync off** (Settings → Sync on the phone or the web app) only stops *that* device syncing. Linked desktop apps stay linked and keep syncing until they are unlinked (Settings → Sync lists them) or you delete them on the server: `DELETE FROM devices WHERE owner = '<your e-mail>'` ends every link at once, and `DELETE FROM pair_codes WHERE owner = '<your e-mail>'` drops open codes.
- **CORS** answers the desktop webview's origins only (`tauri://localhost`, `http://tauri.localhost`, `https://tauri.localhost`). To run the Tauri dev server (`http://localhost:1420`) against a local Worker, put `DEVICE_EXTRA_ORIGINS=http://localhost:1420` in `.dev.vars`; never set it on the deployed Worker.
- **Input.** Every body goes through zod and the same size limits as `/api/sync` (the redeem body is capped at 1 KB). A device name is 1–40 characters after control and invisible formatting characters (bidi overrides, zero-width) are removed, and it is shown as plain text.
- The desktop's CSP allows `https:` for `connect-src` (your server's address isn't known at build time); scripts are still `'self'` only.

### One-time setup for linking (by hand)

Do the migration (`npx wrangler d1 migrations apply pokemon-team-builder --remote`, **before** deploying this version), then let `/api/device/*` through Access, because the desktop can't log in there and the Worker checks the code/token itself:

- Zero Trust → Access → Applications → **Add an application** → Self-hosted, same hostname as the app, **path `/api/device/*` and nothing else**, one policy with action **Bypass** and *Include: Everyone*. Access applies the most specific path, so the rest of the app stays protected. Do not bypass `/api/*`, `/`, or the whole hostname: that would open `/api/pair`, `/api/devices` and the account's own sync routes to anyone. The Worker only treats paths that start with `/api/device/` as device requests, and only these sub-routes exist there: `redeem` (no token), `sync`, `shared`, `shares`, `profile` and `self` (all with a device token). Everything else under the prefix answers 404, and a path such as `/api/device/../pair` is normalised away from the prefix and falls back to the Access check. Nothing under `/api/device/` looks at an Access login or an e-mail header (`worker/__tests__/devices.test.ts`).
- Check, from a computer that is not logged in (or a private window):
  - `curl -i https://<worker>/api/device/sync` → `401 {"error":"this device is not linked…"}` from the Worker, not an Access login page;
  - `https://<worker>/api/sync`, `/api/pair` and `/api/devices` must still show the Access login.

## Tests

`worker/__tests__` (pairing and device tokens in `devices.test.ts`: one-time and expiring codes, hashes only, device limit, account isolation, revoke, CORS; the Access JWT checks with a local JWKS: valid, expired, wrong audience or issuer, bad signature, unknown or rotated key; payload validation; last-write-wins, tombstones, paging and account isolation against a real SQLite running the real migration), `src/domain/__tests__/sync.test.ts` (the merge rules: concurrent edits, delete versus edit, clock skew, first sync) and `src/sync/__tests__/engine.test.ts` (two devices talking to the real Worker handler), `resilience.test.ts` (expiry then recovery, offline then retry with the backoff, a failed push losing nothing, two devices converging after one was signed out), `status.test.ts` (the header light, the diagnostics, the banner state) and `worker/__tests__/session.test.ts` (`/api/session/renew` needs a valid JWT, `/api/health`).
