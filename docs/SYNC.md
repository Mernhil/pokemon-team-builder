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
3. **Apply the migrations** once: `npx wrangler d1 migrations apply pokemon-team-builder --remote`. (Or paste `migrations/0001_init.sql`, then `0002_sharing.sql`, into the D1 console.) Future migrations are applied the same way.
4. **Find the Access values.** Zero Trust → Settings → Custom pages shows the team domain (`<team>.cloudflareaccess.com`). Zero Trust → Access → Applications → the app's application → Overview → **Application Audience (AUD) Tag**.
5. **Set the two variables** on the Worker: Workers & Pages → pokemon-team-builder → Settings → Variables and Secrets → add `ACCESS_TEAM_DOMAIN` (e.g. `myteam.cloudflareaccess.com`) and `ACCESS_AUD` (the tag). `keep_vars` in `wrangler.jsonc` stops deploys from removing them.
6. **Make Access cover `/api/*`.** The Access application protects the Worker's whole hostname (docs/IPHONE_APP.md step 2), so `/api/*` is already behind the login. If you used a path-limited application, add `/api/*` to it. Check: opening `https://<worker>/api/sync` in a private window must show the Access login, not JSON.
7. In the app: Settings → Sync → **Sync with my account**.

## Sharing and comparing (two or more people)

On top of sync, a team folder (a top-level team and its variations) can be shared with another e-mail, and the match log can be shared read-only. Everything below needs sync to be on for both people, and both must be allowed through the Access policy (add the friend's e-mail to the Access application's policy, or the app shows the Access login instead of the page).

- **Shared folders.** Teams → the share button on a team → e-mail and "can view" / "can edit". The grantee finds it under Teams → **Shared with me**, with the owner on the tile. *View only* teams open in the builder with every control off, a banner and **Make my own copy** (the store itself also refuses edits to them). *Can edit* teams go through the same merge as your own documents (`syncOnce` against `/api/shared`), conflict copies included: a copy lands as a variation inside the shared folder. Editors can't delete or create the shared team itself, move teams out of the folder, or share it on. Stopping a share (or the grantee choosing "Stop following") removes the teams from the other person's device on its next sync.
- **Shared match log (opt-in, read-only).** Settings → Sync → Sharing → **Share my matches**. The friend sees them in the Match log's **Whose matches** picker (My matches / their matches / **Both of us**) and in the Meta tab's own-match fallback. They are kept in memory only, never mixed into anyone's stats unless "Both of us" is picked, and never stored on the friend's device.
- **Names and toasts.** Settings → Sync → Sharing → **Your name**. After a sync, a small toast says when someone else changed a team you can see ("Ash updated “Rain M-C” 2 h ago"). There are no push notifications: it only appears while the app is open.
- **Compare view.** More → **Compare teams**: any two teams of one game (mine, shared, or two variations of one team) side by side: set-by-set diff, both type matrices, Speed against the meta and the threat report's verdict.

### Server side

`migrations/0002_sharing.sql` adds `shares` (owner, folder, grantee e-mail, role), `match_shares`, `profiles` (display names) and two columns on `documents` (`folder`, so access checks never parse JSON, and `editor`, who made the last version when it wasn't the owner). Apply it like the first one: `npx wrangler d1 migrations apply pokemon-team-builder --remote`. Until it is applied only sharing fails; plain sync keeps working only after it too, because the Worker now writes the new columns, so apply it before deploying.

- `GET /api/shared`: what other accounts shared with the caller (folders with their role, and match logs), in full each time: at most 200 teams per folder and the 1,000 newest matches per friend.
- `POST /api/shared` `{owner, docs}`: edits to a folder the caller can edit. Every document is checked against the caller's role *and* the folder the document is already in; one refused document refuses the whole batch.
- `GET`/`POST /api/shares`: the caller's own sharing settings (`share`, `unshare`, `leave`, `shareMatches`, `profile`). At most 25 shares and 25 match-log grantees per account; the folder must be a synced top-level team.
- Access is checked on every request, so revoking takes effect immediately. The owner's own `/api/sync` is unchanged, and they see an editor's change as a normal pulled document marked with who made it.
- Shared teams on a device are ordinary team records with a local-only `shared` mark (owner, role); they are never sent as the person's own documents, left out of JSON backups, and the Worker's sanitiser drops the mark.

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

`worker/__tests__` (the Access JWT checks with a local JWKS: valid, expired, wrong audience or issuer, bad signature, unknown or rotated key; payload validation; last-write-wins, tombstones, paging and account isolation against a real SQLite running the real migration), `src/domain/__tests__/sync.test.ts` (the merge rules: concurrent edits, delete versus edit, clock skew, first sync) and `src/sync/__tests__/engine.test.ts` (two devices talking to the real Worker handler). The sharing rules have their own matrix in `worker/__tests__/shares.test.ts` (owner / viewer / editor / stranger on reads and writes, revoking, roles, match-log opt-in, display names) and `src/sync/__tests__/shared.test.ts` (two people through the real handler: mirroring, editing, conflicts, withdrawal); `src/store/__tests__/readOnly.test.ts` covers the client's read-only enforcement.
