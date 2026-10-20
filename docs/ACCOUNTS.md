# Accounts (how it works)

The app's own accounts, replacing Cloudflare Access in steps (docs/ACCOUNTS_PLAN.md is the plan and the reasoning; docs/ACCOUNTS_MANUAL_STEPS.md is what you do by hand). This file describes what is **built**.

## Switch: `AUTH_MODE`

A plain Worker variable. `access` (or unset) is today's behaviour: the account routes below answer 404. `both` turns them on next to Access. `accounts` is for after Access is gone. Health (`GET /api/health`) reports the mode and whether `PASSWORD_PEPPER` / `SETUP_CODE` exist (booleans only).

## Secrets (Worker → Settings → Variables and Secrets)

- `PASSWORD_PEPPER`: mixed into every password hash. A stolen D1 backup alone can't be brute-forced; **losing it makes every password unusable**, so keep a copy.
- `SETUP_CODE`: lets the very first account sign up (it becomes admin). It works only while there are no users; delete it afterwards.

## Routes (`worker/authApi.ts`)

| Route | Needs | Does |
|---|---|---|
| `POST /api/auth/params` | a username | the salt and rounds to derive that username's key with (a stable fake for unknown names) |
| `POST /api/auth/signup` | an invite code (or `SETUP_CODE` for the first account) | creates the account, returns the recovery code once, starts a session |
| `POST /api/auth/login` | username + derived key | starts a session |
| `POST /api/auth/recover` | username + recovery (or admin reset) code + new salt and key | sets the password, signs every device out, returns a new recovery code |
| `POST /api/auth/logout`, `/logout-all` | session | ends this / every session |
| `GET`/`PUT /api/me` | session | the user; display name |
| `POST /api/me/password` | session + current key | changes it, signs the other devices out |
| `POST /api/me/recovery` | session + key | a new recovery code |
| `GET`/`DELETE /api/sessions` | session | list / revoke devices |
| `GET`/`POST`/`DELETE /api/admin/invites` | admin | list (never the codes) / make one (the code once; note, 1 hour–30 days) / revoke an open one |
| `GET /api/admin/users` | admin | every account: role, disabled, devices, last seen, who invited it |
| `POST /api/admin/users/disable`, `/enable` | admin | disable (signs the account out everywhere at once) or enable |
| `POST /api/admin/users/role` | admin | make or remove an admin |
| `POST /api/admin/users/reset` | admin + the admin's own key | a one-time reset code for the user (shown once) |
| `GET`/`POST /api/claim` | session (+ an Access JWT for the e-mail) | what a claim would bring / bring it (only with `AUTH_MODE=both`) |
| `POST /api/claim/skip` | session | the account has nothing from before |

Bodies are zod-validated (`src/domain/accounts.ts`) and capped at 2 KB.

While Cloudflare Access is still in front of the site, the desktop app can't pass it, so it calls the same routes under `/api/device/` (`/api/device/auth/login`, `/api/device/me`, …): that path is already a Bypass path in Access (docs/SYNC.md), and the Worker answers the account routes there exactly as under `/api/`. The last PR of the plan moves the desktop app back to `/api/` when `/api/device/*` goes.

## Sessions

- A random 32-byte token (`ptbs_…`); **only its SHA-256 is stored** (`sessions`). Every request looks it up in D1 joined with the user, so a revoked session, a disabled user or an expired token fails on the next request.
- Web / phone app: the cookie `__Host-ptb_session` (HttpOnly, Secure, SameSite=Strict). Desktop app: `mode: "token"` in the login body gets the token back and sends it as `Authorization: Bearer`; only requests from the desktop webview's origins can ask for that.
- Lifetime 180 days from last use (renewed at most once a day, and the cookie re-set), never more than a year from creation. At most 20 sessions per account.
- **CSRF:** a cookie request that changes something, and every login/signup/recover, must come with `Origin` equal to the site (or a desktop origin) and the header `X-PTB: 1`. Bearer requests need neither.

## In the app

- **Settings → Account** (`src/components/settings/AccountSettings.tsx`, forms in `src/components/account/AccountForms.tsx`; `#account` and *Account* in the command palette open it). Signed out: *Create account* (invite code, username, password), *Log in*, *Forgot password?* (recovery code or an admin's reset code). Signed in: the name others see, **Devices** (every session, sign one out after asking), *Change password*, *Recovery code* (make a new one), *Log out*, *Log out everywhere*.
- **The recovery code** is shown once (after signup, recovery, or making a new one) with *Copy code* and an *I saved it* tick that unlocks *Continue*. It is never stored on the device.
- **Calls** (`src/sync/account.ts`): the rules (`usernameProblem`, `passwordProblem`) are checked before anything is sent; signup and recovery derive with a fresh `newSalt()`; login asks `POST /api/auth/params` for the salt, derives, then logs in. Every call sends `X-PTB: 1`; the web app uses the cookie (`credentials: same-origin`), the desktop app its bearer token (`credentials: omit`). Sync calls (`src/sync/http.ts`) send `X-PTB: 1` too.
- **`ptb:session:v1`** (`src/sync/accountStore.ts`, sanitised on load): the user to show (id, username, display name, role), and on the desktop app also the server address and the `ptbs_` token. The web session is the HttpOnly cookie; the store never holds it.
- **When a session ends** (a `401 not signed in` from any account call, or the check at start), the device keeps the username but marks the session expired; the banner at the top says *Your sign-in has expired* and **Sign in again** opens the login dialog in place (`src/components/account/LoginDialog.tsx`). A Cloudflare Access expiry is still handled as before (Settings → Sync).
- **At start** the app asks `GET /api/me` only when it matters (signed in, or the first-run card not dismissed): `404` means accounts are off on this server. With accounts on and no account, a one-time card says *Make an account to sync and share* (`AccountCard.tsx`).
- **Not yet:** sync and sharing still go through Cloudflare Access (and pairing for the desktop app) until step 5; being logged in or out doesn't change sync yet.

## Passwords (`worker/password.ts`)

**The password never reaches the Worker.** Workers Free allows 10 ms of CPU per request, which a server-side PBKDF2 (capped at 100,000 rounds there) may not fit, and the plan must not need the paid tier. So the slow step runs on the person's device: `deriveKey` (`src/domain/accounts.ts`) computes PBKDF2-HMAC-SHA256 of the NFKC password with a per-user 16-byte salt and **600,000 rounds** (OWASP's number; about a second on a phone) and sends the 32-byte result, not the password. The Worker stores `ckdf-pbkdf2-sha256$i=…$p=…$salt$mac`, where `mac` is HMAC-SHA256(`PASSWORD_PEPPER`, key) (`worker/password.ts`), and compares in constant time: a few microseconds of CPU. A stolen database has MACs it can't test guesses against without the pepper, and each guess would cost 600,000 rounds.

`POST /api/auth/params {username}` returns the salt and rounds to derive with. A name that doesn't exist gets a stable, real-looking salt derived from the pepper and the name, so it reveals nothing. A new password is set by sending a new salt and key (signup, recovery, password change). The server refuses fewer than 100,000 rounds and malformed keys.

Because the server never sees the password, the length, blocklist and username rules (`passwordProblem`) are checked by the app; a modified client could set a weak password for its own account, which only weakens that account, and the throttles still apply. The rounds can be raised later (the stored value carries them); there is no automatic upgrade at login in this version, changing the password does it.

## Throttling (`worker/throttle.ts`, table `throttles`)

D1 counters, keyed by a hash of the pepper, the scope and the client address / username, in fixed windows: login 20 per 10 minutes per address and 8 failures per 15 minutes per username; signup 10 per 10 minutes and 5 wrong invites per hour per address; recovery 10 per hour per address and 5 per hour per username; password checks 8 per 15 minutes per account. The address is `CF-Connecting-IP` (IPv6 reduced to its /64). Answers are `429` with `Retry-After`. Login, recovery and invites answer identically whatever is wrong.

## Invites (`worker/invites.ts`, `worker/admin.ts`)

12 symbols (60 bits) from the unambiguous alphabet, shown as `K7QM-3XWD-9PTR`, single use, 7 days by default (1 hour to 30 days), only the SHA-256 stored. The invite is consumed in the same D1 batch that creates the user, so two signups racing for one invite can't both win. An admin makes them in Settings → Account → Admin (or `npm run admin -- invite`); the code is shown once and the list only shows the note, status, dates and who used it. Send the **code**, never a link.

## Admin (`worker/admin.ts`, Settings → Account → Admin)

- Every admin route checks `role = 'admin'` from the session's own D1 lookup, so a demoted admin loses the rights on the next request. Bodies are capped at 4 KB.
- **Disable** deletes all the account's sessions (it is out on its next request) and its pending reset codes; **enable** lets it log in again. Nobody can disable themselves.
- **The last admin stays**: demoting or disabling the only enabled admin is refused, whoever asks.
- **Reset password**: needs the admin's own password again, and makes a 20-symbol code valid 24 hours, once (a newer one replaces it). The user enters it under *Forgot password?* with a new password; every one of their devices is signed out. The admin never sees or sets the password.
- Every action writes an `events` row (`at`, `actor` = the admin's id or `cli`, `kind` such as `invite.create`, `user.disable`, `user.reset`, `target` = a user id or an invite handle). No codes.

## `npm run admin` (scripts/admin.ts)

For when nobody can use the app's Admin screen. Needs `npx wrangler login`; works on the remote database (`--local` for the dev one, `--db <name>` for another name).

| Command | Does |
|---|---|
| `npm run admin -- list` | accounts, roles, disabled, devices |
| `npm run admin -- invite --note "for Sam" --days 7` | prints a new invite code once |
| `npm run admin -- reset <username>` | prints a one-time reset code (24 hours) for *Forgot password?* |
| `npm run admin -- disable <username>` / `enable <username>` | as in the app (never the last admin) |
| `npm run admin -- bootstrap <username>` | the first admin when there are no accounts and `SETUP_CODE` can't be used: prints a reset code; the person then uses *Log in → Forgot password?* with it to choose a password |

Values are bound (`scripts/lib/adminSql.ts`, tested in `worker/__tests__/adminScript.test.ts`), usernames and the database name are checked, and writes go to wrangler in a temporary file, so nothing typed reaches a shell. Actions are logged in `events` with the actor `cli`.

## Bring my teams from before (`worker/claim.ts`, `migrations/0006_claims.sql`)

Before accounts, every document, share and linked desktop app was keyed by the Cloudflare Access e-mail. A **claim** moves all of it to the account's id, once:

- **When:** only with `AUTH_MODE=both` (Access still in front), and only when **one request carries both** the account's session and a verified Access JWT; the e-mail comes from the JWT, never the body. The account must be **fresh** (no documents, no sync sequence, no shares, never claimed). One e-mail can be claimed by one account (`users.legacy_email` is unique).
- **What:** one D1 batch (a transaction) rewrites `owner` from the e-mail to the id in `documents`, `sync_seq`, `shares.owner`, `shares.grantee`, `devices` and `pair_codes`, copies the name from `profiles` to the account, sets `legacy_email` and `claim_state = 'claimed'`, and writes `account_claims` (counts, for the record and the way back) and an `events` row. The first statement claims only a fresh account; every later one only runs if it did, so a refused claim changes nothing.
- **Why nothing breaks:** only `owner`/`grantee` change. Ids, `updated_at`, tombstones, folders and **`server_seq` stay**, and `sync_seq` moves with them, so every device's cursor and `known` map stay valid: nothing is pulled again, nothing becomes a conflict copy (tested: an old cursor pulls nothing new).
- **After:** with accounts on, a verified Access e-mail that an account claimed **is** that account (`ownerForEmail`), so the phone and the website keep syncing through Access exactly as before, and linked desktop apps keep their device tokens (`devices.owner` moved). Sharing with a claimed e-mail reaches the account; names come from the account's display name or username. A disabled account can't sync through Access or an old desktop link.
- **Pending / skipped:** a new account made while Access is in front starts `pending` (`GET /api/me` says `claim` and `claimAvailable`); the app shows *Bring my teams from before* right after signup and in Settings → Account, with *Skip* (`skipped`; it can still claim later while fresh). Made without Access (`AUTH_MODE=accounts`): `skipped`.
- **Desktop:** it can't pass Access, so it can't claim; claim from the web, the desktop's link moves with the account.
- **From a terminal** (`npm run admin`): `claim <email> <username> --backup <file>` (refuses without a backup file; same SQL as the Worker) and `unclaim <username>` (everything the account owns goes back to the e-mail, `claim_state` back to `pending`, `account_claims.undone_at` set). With `AUTH_MODE=access` only unclaimed data is visible again, so roll back a claim with `unclaim` before switching to `access`.
- **Backups:** `.github/workflows/d1-backup.yml`, weekly and by hand: `wrangler d1 export`, encrypted with `age`, a private artifact for 30 days (docs/SYNC.md).

## Tables (`migrations/0005_accounts.sql`, `0006_claims.sql`)

`users` (with `claim_state` from 0006), `sessions`, `invites`, `reset_codes`, `throttles`, `events` (audit, no secrets), `credentials` (reserved for passkeys, unused) and `account_claims`. Nothing reads them while `AUTH_MODE` is `access`.

## Tests

`worker/__tests__/accounts.test.ts`: rules, hashing parameters, the routes being off by default, first account and invites (single use, expiry, revoke, race), login answers and throttles, rehash on login, token mode (and the `/api/device/` paths), sessions (hash only, revoke on the next request, logout everywhere, disabled, expiry, renewal, the limit), CSRF, password change and recovery, no secrets in console output.

`worker/__tests__/claim.test.ts`: the preview, session + verified JWT on one request (not the body, not a forged JWT, CSRF), everything moved and every cursor intact (an old cursor pulls nothing new, the next push continues the sequence), the desktop link still works, the friend's shared folder and edits, sharing with a claimed e-mail, claim twice / an e-mail already claimed / a non-fresh account refused with nothing changed, only in `both`, skip, a disabled claimed account, unclaim (and claiming again), the script's SQL.

`worker/__tests__/admin.test.ts`: admins only (and a demoted admin at once), CSRF, invites (once, never listed, revoke, expiry, the note), users (disable signs out, enable, never yourself, never the last admin, a disabled admin doesn't count), reset codes (the admin's password, once, 24 hours, replaced, not for a disabled account), events, nothing secret in the console.

`src/sync/__tests__/account.test.ts`: the password never in a request, the derived key, `X-PTB`, cookie vs bearer, a `401` marking the session expired, accounts off, logout while offline, the stored state's sanitising. `e2e/account.spec.ts` (API mocked): the first-run card, signup with the recovery code, a wrong password, log in and out, the banner's login dialog, signing a device out, the Admin screen (an invite shown once, disabling after asking, a reset code that needs the admin's password), password-manager attributes, 16 px inputs on phones, no overflow at 320–430 px, axe.
