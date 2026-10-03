# Cloud sync (web app and phone app)

Syncs your **teams** (with their folders and variations) and your **match log** across the devices you
use the web app on, through the Cloudflare deployment that already hosts it (docs/IPHONE_APP.md). It is
opt-in (Settings → Sync), the app stays offline-first (localStorage is always the source of truth), and
nothing else is synced: not the theme, picker favourites or calculator state.

## How it works

- `worker/` is a Worker that answers `/api/*` only. `wrangler.jsonc` sets `assets.run_worker_first: ["/api/*"]`, so every other request is served from the static assets exactly as before.
- **Identity** is the e-mail inside the `Cf-Access-Jwt-Assertion` header that Cloudflare Access adds. `worker/auth.ts` verifies its RS256 signature against the Access team's keys (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`), then the issuer, the audience (`ACCESS_AUD`) and the expiry. A plain e-mail header is never trusted.
- **Storage** is one D1 table, `documents` (`migrations/0001_init.sql`): one row per account and document (a team or a match), with a tombstone row (`deleted = 1`) for deletes and a per-account `server_seq` that is the sync cursor.
- **Endpoints:** `GET /api/sync?since=<seq>` (documents after a cursor, paged) and `POST /api/sync` (up to 100 documents). Every payload is validated with zod (`src/domain/syncProtocol.ts`), is limited in size (64 KB per document, 1 MB per request), and each team or match goes through the same sanitisers the app loads its own data with before it is stored. A document stamped more than 10 minutes in the future is refused (a wrong clock would win every conflict).
- **Merge rule** (`src/domain/sync.ts`): last write wins per document by `updatedAt`, a delete is just another version. When both sides changed a team since the last sync, the losing version is kept as a variation labelled **Conflict copy (<device>, <date>)**; matches follow the same rule without copies. Clocks within 5 seconds of each other are treated as a tie (the server's version wins and the other is kept as a copy), and an edit beats a delete unless the delete is clearly later.
- **Client** (`src/sync/`): syncs when it starts, when the window regains focus, 5 seconds after teams or matches change, and on "Sync now". The first sync on a new device merges with what is already there (nothing is wiped). The code loads only once sync is on.

Only the web app can sync. The Tauri desktop app can't pass Cloudflare Access without a browser login, so Settings says "Sync is available in the web app" there. The single-file/artifact build has sync disabled.

## One-time setup (by hand)

Until step 1 and 2 are done the app works exactly as before and `/api/sync` answers `501 sync is not set up`.

1. **Create the D1 database** (Cloudflare dashboard → Workers & Pages → D1 → Create database, or `npx wrangler d1 create pokemon-team-builder`). Copy its **database id**.
2. **Bind it** in `wrangler.jsonc`: uncomment the `d1_databases` line at the bottom and paste the id (and add the comma shown on the line above it). Commit and push; Workers Builds redeploys.
3. **Apply the migrations**: `npx wrangler d1 migrations apply pokemon-team-builder --remote` applies every file in `migrations/` that hasn't run yet (0001 creates the documents table, 0002 adds sharing and a `group_id` column). **Run it before the deploy of a version that adds a migration**: the sync code of this version writes `group_id`, so sync answers with an error until 0002 is applied. (Or paste the files into the D1 console, in order.)
4. **Find the Access values.** Zero Trust → Settings → Custom pages shows the team domain (`<team>.cloudflareaccess.com`). Zero Trust → Access → Applications → the app's application → Overview → **Application Audience (AUD) Tag**.
5. **Set the two variables** on the Worker: Workers & Pages → pokemon-team-builder → Settings → Variables and Secrets → add `ACCESS_TEAM_DOMAIN` (e.g. `myteam.cloudflareaccess.com`) and `ACCESS_AUD` (the tag). `keep_vars` in `wrangler.jsonc` stops deploys from removing them.
6. **Make Access cover `/api/*`.** The Access application protects the Worker's whole hostname (docs/IPHONE_APP.md step 2), so `/api/*` is already behind the login. If you used a path-limited application, add `/api/*` to it. Check: opening `https://<worker>/api/sync` in a private window must show the Access login, not JSON.
7. In the app: Settings → Sync → **Sync with my account**.

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
- D1 also keeps Time Travel restore points for 30 days: `npx wrangler d1 time-travel info pokemon-team-builder`, then `... restore ... --timestamp=<time>`.
- The app itself is a backup too: each device keeps a full copy in localStorage, and Import / Export → JSON backup still works.
- Tombstones (deleted documents) are kept forever and are tiny. To prune old ones: `DELETE FROM documents WHERE deleted = 1 AND updated_at < <ms>`; a device that hasn't synced since then could bring a deleted document back.

## Turning sync off and keeping your data

Settings → Sync → untick **Sync with my account**. Everything on the device stays exactly as it is; it just stops sending and receiving. Your documents stay on the server until you delete them there (`DELETE FROM documents WHERE owner = '<your e-mail>'`). Turning it on again later merges (it doesn't wipe either side).

## Desktop app: future options

The desktop app has no Access login, so it can't sync today. Two ways to add it:

1. **Access service token.** Create a service token in Zero Trust and a policy that allows it for `/api/*`; the desktop app sends `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers (stored in the OS keychain through a Tauri plugin). Simple, but the token is a shared secret that identifies the *app*, not a person, so the Worker would need to map it to one account (an extra `ACCESS_SERVICE_OWNER` variable) and every desktop install shares it.
2. **Browser login hand-off.** The desktop app opens the web app's login in the system browser (Tauri's `shell`/`opener`), Access redirects back to a `http://localhost:<port>` or `ptb://` callback with a short-lived code that the Worker exchanges for a per-device token. Better identity (per person, revocable per device), more to build: a token table in D1 and a callback listener in the Tauri shell.

Either way the sync code in `src/sync/` and the Worker's `/api/sync` stay the same; only how a request proves who it is changes.

## Tests

`worker/__tests__` (the Access JWT checks with a local JWKS: valid, expired, wrong audience or issuer, bad signature, unknown or rotated key; payload validation; last-write-wins, tombstones, paging and account isolation against a real SQLite running the real migration), `src/domain/__tests__/sync.test.ts` (the merge rules: concurrent edits, delete versus edit, clock skew, first sync) and `src/sync/__tests__/engine.test.ts` (two devices talking to the real Worker handler).
