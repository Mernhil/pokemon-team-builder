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

The web app syncs through Cloudflare Access. The Tauri desktop app can't pass Access, so it is **linked with a pairing code** (below), and so can the **installed iPhone app**, which can't keep an Access login for long (see *The installed iPhone app*).

## One-time setup (by hand)

Until the steps below are done the app works exactly as before and `/api/sync` answers `501 sync is not set up`. The answer lists what is missing (`{"missing": ["DB", "ACCESS_AUD"]}`) and Settings → Sync shows it in words, e.g. “the D1 database isn’t bound (steps 1–3)”.

1. **Create the D1 database** (Cloudflare dashboard → Workers & Pages → D1 → Create database, or `npx wrangler d1 create pokemon-team-builder`). Copy its **database id**.
2. **Bind it** in `wrangler.jsonc`: uncomment the `d1_databases` line at the bottom and paste the id (and add the comma shown on the line above it). Commit and push; Workers Builds redeploys.
3. **Apply the migrations**: `npx wrangler d1 migrations apply pokemon-team-builder --remote` applies every file in `migrations/` that hasn't run yet (0001 creates the documents table, 0002 adds sharing and a `group_id` column, 0003 adds linked devices, 0004 the redeem throttle). Once the deploy command below is set, every deploy does this by itself, **before** the new code goes live (the sync code of a version that adds a migration needs it: for example 0002's `group_id`). By hand, or pasting the files into the D1 console in order, also works.
4. **Find the Access values.** Zero Trust → Settings → Custom pages shows the team domain (`<team>.cloudflareaccess.com`). Zero Trust → Access → Applications → the app's application → Overview → **Application Audience (AUD) Tag**.
5. **Set the two variables** on the Worker: Workers & Pages → pokemon-team-builder → Settings → Variables and Secrets → add `ACCESS_TEAM_DOMAIN` (e.g. `myteam.cloudflareaccess.com`) and `ACCESS_AUD` (the tag). `keep_vars` in `wrangler.jsonc` stops deploys from removing them.
6. **Make Access cover `/api/*`.** The Access application protects the Worker's whole hostname (docs/IPHONE_APP.md step 2), so `/api/*` is already behind the login. If you used a path-limited application, add `/api/*` to it. Check: opening `https://<worker>/api/sync` in a private window must show the Access login, not JSON.
7. **Set the deploy command** (below), so migrations are applied on every deploy.
8. **Set the Access session duration** to 1 month (see *Sign-in expired*, which also lists what the phone app needs).
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

Access signs you out after the session duration. What the app does when that happens:

1. **The app shell never needs the session.** The installed app is the cached app: the service worker (`vite.config.ts`, Workbox precache) answers every navigation from its cache without touching the network, so opening, editing and every screen work signed out and offline. Its update check (`src/pwa.ts`, `registration.update()`) fetches the worker script; behind an expired Access session that is a redirect to the login, which the browser treats as a failed update. It is caught and ignored (`onRegisterError`, `.catch`): the app keeps the version it has and updates once the session is back. `navigateFallbackDenylist: [/^\/api\//]` keeps navigations to `/api/*` out of the cache. `e2e/phone-signin.spec.ts` reloads the app offline from the worker's cache.
2. **Expiry is noticed and said in words.** Every sync call uses `redirect: 'manual'` (`src/sync/http.ts`), so Access's 302 to `https://<team>.cloudflareaccess.com/…` is seen as an *opaque redirect* instead of being followed (a followed one would be a CORS failure that looks like "offline"). `accessSessionEnded` (`src/domain/accessSession.ts`, tested in `src/domain/__tests__/accessSession.test.ts`) treats an opaque redirect, any 3xx, a 401 or 403, and a redirect that ended on `cloudflareaccess.com` as "the sign-in ended": a `signin` error (`syncStore.lastErrorKind` is `signin` | `offline` | `setup` | `other`, status 0 for the redirect). A banner at the top says it (dismissible; it comes back with the next new failure), the header sync light turns red, and Settings → Sync shows the same message. Other errors show a *Sync problem* chip that opens Settings → Sync; Settings has the diagnostics.
3. **What the message says depends on where the app runs** (`signedOutMessage`):
   - installed phone app: *Session expired: link this phone with a code, or sign in from Safari.* with **Open Settings** (no "Sign in again": see below);
   - a phone linked with a code whose token was refused: *This phone is no longer linked. Link it again with a new pairing code (Settings → Sync).*;
   - an ordinary browser tab: *Your sign-in has expired. Tap Sign in again.* **Sign in again** sets `location.href = '/api/session/renew'` (never `window.open`); Access shows its login in that tab, and the Worker answers `GET /api/session/renew` (it needs a valid Access JWT, otherwise 401) with `302 /`. Sync resumes by itself;
   - the desktop app: *This desktop app is signed out. Log in again in Settings → Account.*
   Local data is never touched: edits made while signed out are sent afterwards. **The app never navigates to the login by itself.**
4. **Access must stay in front of `/api/session/renew`** (the browser-tab flow): it is covered by the same application as the rest of the hostname (do not add it to a bypass). Check from a private window: `https://<worker>/api/session/renew` shows the Access login, not a redirect to the app.

### The installed iPhone app (why it can't just sign in again)

On iOS the Home Screen app is a separate browser context with **its own cookie jar**, not shared with Safari. Access's login is a cross-site page (`cloudflareaccess.com`), so when the app navigates there iOS shows it in an in-app browser sheet; the login completes in that sheet and the `CF_Authorization` cookie is stored there, not in the app. The last redirect back to the app's own page then ends on a white page, and the app never gets the cookie. (This is the likely cause of the white page, from how iOS treats standalone web apps and from what the code did before: `signInAgain` navigated the app's window to `/api/session/renew` and relied on the cookie landing in the app's jar. It could not be checked on a real device from here, which is why the fix doesn't depend on it.) Signing in from Safari and re-adding the app worked only because a fresh install starts from Safari's cookie.

So the installed app is **linked with a pairing code** like the desktop app, and then never needs the Access cookie for sync:

1. On a device that is signed in, make a code: **Safari on the same phone** (open the site, Settings → Sync → *Make a pairing code*) or the website on a computer. It is valid 10 minutes, single use.
2. In the installed app: Settings → Sync → **Link this phone with a pairing code**, type the code → **Link this phone**. (The form opens by itself when the session has expired.) The app trades the code for a **device token** (`POST /api/device/redeem`, same endpoint and rules as the desktop: one-time code, hash-only storage, rate limit, 10 devices per account) and from then on sends it as `Authorization: Bearer` to `/api/device/sync` etc., with `credentials: 'omit'`. `/api/device/*` is already a Bypass path in Access (below), so no cookie is involved. The phone shows up in the other devices' *Linked desktop apps* list by the name in *This device is called* and can be unlinked from there at once, or with **Unlink this phone**.
3. A linked phone cannot make pairing codes or list devices (those need Access); make codes in Safari or on the computer. The server-check line is hidden on a linked phone (`/api/health` isn't a device route).
4. If the token is ever refused (unlinked from another device), the banner says *This phone is no longer linked*; link again with a new code.

Token trade-off: same as the desktop (below): the token lives in the app's local storage (`ptb:device:v1`), next to the teams it syncs; it is revocable from any signed-in device. A phone linked with a code and signed in to an account (docs/ACCOUNTS.md) uses the account session instead.

**What a link cannot fix:** if iOS has evicted the app's service worker and cache (Safari clears website data after weeks without use), the next launch is a real navigation to Access, and Access's login can't return to the app. Then only signing in from Safari and re-adding the app helps (the same as before). The longest session duration (below) and opening the app now and then keep this rare.

**By hand in the Cloudflare dashboard** (nothing else changes: no migration, no Worker variable, no deploy step; linking a phone uses the pairing tables and the bypass already set up for the desktop):
1. **Session duration to the longest: 1 month.** Zero Trust → Access → Applications → the app's application → **Edit** → **Basic information** (or *Settings*) → **Session duration** → **1 month**; Save. Also check Zero Trust → Settings → Authentication → **Global session timeout**, which can cap it. A longer session means fewer expiries (and fewer reasons to leave the app); it does not remove them, and it does not help the installed app, which has no Access cookie at all.
2. **Check the Bypass application for `/api/device/*`** exists (it is the one from *One-time setup for linking*): Zero Trust → Access → Applications → Self-hosted, the same hostname, **path `/api/device/*` and nothing else**, one policy, action **Bypass**, *Include: Everyone*. Without it the phone's link and sync calls are redirected to the login and the app says the session expired. Check from a private window: `curl -i https://<worker>/api/device/sync` → `401` JSON from the Worker, not an Access page.
3. Nothing to change for the phone app's own address, policies or login method.

**Manual test on the iPhone app.**
1. Settings → Sync on; wait for the green dot.
2. Expire the session: Zero Trust → Access → *Users* (Zero Trust → Team & Resources → Devices/Users) → your user → **Revoke session** (or set a 5-minute session duration, wait, and set it back to 1 month).
3. Bring the app to the foreground or tap **Sync now**: the red banner *Session expired: link this phone with a code, or sign in from Safari.* appears and the header dot is red. The app still opens and edits. Edit a team meanwhile.
4. In Safari: sign in, Settings → Sync → **Make a pairing code**. In the app: Settings → Sync → **Link this phone with a pairing code**, enter it.
5. The dot turns green, Settings → Sync says *Last synced just now* and *This phone is linked with a pairing code*, and the edit made in step 3 shows on the website's copy after its next sync. Revoke the session again: nothing changes for the app now.

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

The desktop app has no Access login, so the phone (or the website) vouches for it. (The installed iPhone app links the same way, with the code typed in Settings → Sync; see *The installed iPhone app*.)

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

`worker/__tests__` (pairing and device tokens in `devices.test.ts`: one-time and expiring codes, hashes only, device limit, account isolation, revoke, CORS, and a phone on the same origin with a token and no Access login: the token decides, a refused token is 401 JSON; the Access JWT checks with a local JWKS: valid, expired, wrong audience or issuer, bad signature, unknown or rotated key; payload validation; last-write-wins, tombstones, paging and account isolation against a real SQLite running the real migration), `src/domain/__tests__/sync.test.ts` (the merge rules: concurrent edits, delete versus edit, clock skew, first sync) and `src/sync/__tests__/engine.test.ts` (two devices talking to the real Worker handler), `resilience.test.ts` (expiry then recovery, offline then retry with the backoff, a failed push losing nothing, two devices converging after one was signed out), `status.test.ts` (the header light, the diagnostics, the banner state) `worker/__tests__/session.test.ts` (`/api/session/renew` needs a valid JWT, `/api/health`), `src/domain/__tests__/accessSession.test.ts` (what counts as an ended Access session, and the message for each place the app runs) and `src/sync/__tests__/phone.test.ts` (a phone linked with a code syncs with the bearer token while the Access cookie is missing). `e2e/phone-signin.spec.ts` (iPhone project) answers `/api/sync` with a 302 to the login and checks the message, that the app stays usable and never navigates away, that a code brings sync back, and that the app shell opens offline from the service worker.
