# Own accounts instead of Cloudflare Access, then a friend list: the plan

Status: **being built, one PR per step of section 14.** docs/ACCOUNTS.md describes what exists; docs/ACCOUNTS_MANUAL_STEPS.md is the checklist of what you do by hand.

Scope: about 10 people, invite-only, on the public internet, on the existing Cloudflare Worker + D1. Small on purpose: no e-mail sender, no third-party identity provider, no new services.

> **What I could and could not verify.** The planning sandbox could not reach developers.cloudflare.com (the proxy refuses it), so the Workers numbers below are from memory plus one third-party post, not from the current docs. The two that matter (the PBKDF2 iteration cap, and CPU time per request on your plan) are therefore a **measured spike in PR 1**, with a fallback written down in section 2. Everything about this repository's own code was read directly.

---

## Open questions (answer in one pass; each has my default)

| # | Question | Default if you just say "go" |
|---|---|---|
| Q1 | ~~Is the Worker on the Workers Paid plan?~~ **Decided: it must work on the Free plan.** | The slow password hashing runs on the device (section 2), so the Worker needs almost no CPU. Nothing to buy. |
| Q2 | Passkeys in v1? | **No, v1.1** (section 1). v1 ships username + password. |
| Q3 | E-mail one-time codes? | **No.** Not in v1, probably never (section 1). |
| Q4 | Web/PWA identified by an HttpOnly cookie, desktop by a bearer token? | **Yes** (section 3). |
| Q5 | Session lifetime? | **180 days sliding**, 1 year absolute cap. |
| Q6 | How is an invite handed over? | **A code you copy and send** (like `K7QM-3XWD-9PTR`). **No invite link**, so nothing secret is ever in a URL. |
| Q7 | How is the first account (yours) created? | A **`SETUP_CODE` secret** you set once in the dashboard; it works only while there are zero users, and that account becomes admin. |
| Q8 | Game art once the site is public? | **(a) accept it, with `noindex` + an unlisted URL**, and the gating described in (b) kept as a ready-made follow-up (section 8). I also want your say, because it is a legal-risk choice, not a technical one. |
| Q9 | Where does the desktop app keep its session? | **localStorage** as today, trade-off written down (section 11). OS keychain later if you want it. |
| Q10 | Can friends see each other without a request? | **No.** Request → accept. Sharing a team needs an accepted friendship. |
| Q11 | A weekly D1 backup workflow? There is **none today** (SYNC.md only documents `wrangler d1 export`). | Add `d1-backup.yml`: weekly + manual, **age-encrypted** export kept as a private 30-day artifact. Needs two secrets from you. Always back up by hand before PR 4. |
| Q12 | Remove the pairing code and `/api/device/*` completely? | **Yes**, in the last PR. Desktop logs in with username + password like everything else. |
| Q13 | Legacy data nobody claims? | Kept (rows keyed by e-mail, invisible to everyone) for 90 days after go-live, then you decide to purge. |
| Q14 | A Cloudflare WAF rate-limit rule on `/api/auth/*` in addition to my D1 counters? | Optional, **recommended**, one dashboard rule (section 6). |

---

## 0. What exists today (so the plan can be checked against it)

- `worker/auth.ts` verifies the Access JWT (`Cf-Access-Jwt-Assertion`); `worker/api.ts` takes the e-mail inside as the account (`owner`). That is the only identity. There is no password, session or user table.
- `documents.owner`, `sync_seq.owner`, `shares.owner/grantee`, `profiles.email`, `devices.owner`, `pair_codes.owner` all hold that e-mail as text. `server_seq` is per owner.
- Desktop: `POST /api/device/redeem` (pairing code → `ptbd_…` token; only the SHA-256 is stored, `worker/devices.ts`), `/api/device/*` must be an Access **Bypass** path. Throttle: `redeem_attempts` (a D1 counter keyed by a hash of `CF-Connecting-IP`).
- Phone/web: the Access cookie; expiry is detected in `src/sync/http.ts` (`opaqueredirect`/401/403) and fixed by `GET /api/session/renew` + banner + the service-worker denylist for `/api/`.
- Sharing: `ShareSchema.grantee` is an e-mail; `namesFor` maps e-mail → `profiles.display_name`.
- Static files (JS, data, 16 MB of sprites, ~0.6 MB of map art) are behind Access today, so they are private. Without Access they are public.
- `wrangler.jsonc` has `keep_vars: true`, `run_worker_first: ["/api/*"]`, `preview_urls: false`, D1 `DB`.

---

## 1. Sign-in method

**Recommendation for v1: username + password only.** Passkeys are a clean v1.1; e-mail codes are not worth it.

| Option | For | Against | Verdict |
|---|---|---|---|
| **Username + password** | Works on every client, including the Tauri desktop webview and offline-first first run; password managers fill it; no external service. | Needs careful storage, throttling and a recovery story (sections 2, 5, 6). | **v1** |
| **Passkeys (WebAuthn)** | Face ID on iPhone, no password to steal or phish, free. | A passkey is bound to an origin (the RP ID is the hostname). The Tauri webview's origin is `tauri://localhost`, which cannot use a passkey for `*.workers.dev`, so the desktop still needs a password. It needs a credential table, challenge storage, a CBOR/COSE verifier in the Worker (a library or ~300 lines) and its own recovery rules. A custom domain later would change the RP ID and orphan every passkey. | **v1.1, as a second method** on the web/PWA only, after the password path is solid. The schema reserves `credentials` for it (section 12). |
| **E-mail one-time code** | No password at all. | Needs a sender: Cloudflare's Email Sending (beta when I last knew of it) or a third party, a domain with SPF/DKIM/DMARC, and a verified address per user; deliverability to ~10 friends' mailboxes becomes your support problem; an e-mail code is only as safe as the mailbox. It adds a service and a failure mode (can't log in when mail is delayed) to buy something passwords + a recovery code already give. | **Rejected for v1.** Reconsider only if people keep losing recovery codes. |
| Sign in with Google/GitHub | Nothing to store. | Third-party dependency; excludes people without that account; Worker must implement OAuth. | Rejected (the point is to not depend on an identity provider). |

---

## 2. Password storage

> **Revised for the Workers Free plan** (10 ms of CPU per request). The original design hashed on the server; that may not fit in 10 ms and is capped at 100,000 PBKDF2 rounds there. The design below replaces it and is what is built (docs/ACCOUNTS.md).

### 2.1 Design: the device stretches, the Worker only MACs

- The app derives a 32-byte key with **PBKDF2-HMAC-SHA256, 600,000 rounds** (OWASP's current number) from the NFKC password and a per-user random 16-byte salt, using WebCrypto in the browser or the Tauri webview (about a second on a phone). It sends that key, **never the password**.
- The Worker stores `ckdf-pbkdf2-sha256$i=600000$p=1$<salt>$<mac>` with `mac = HMAC-SHA256(PASSWORD_PEPPER, key)`, and checks a login with one HMAC and a constant-time compare: microseconds of CPU, well inside the Free plan.
- `POST /api/auth/params {username}` returns the salt and rounds. An unknown name gets a stable fake derived from the pepper and the name (same shape, same answer every time), so it reveals nothing. A throttle applies.
- A stolen database holds pepper-keyed MACs: without the pepper (a Worker secret, not in D1) an attacker cannot even test a guess, and with it each guess costs 600,000 rounds. This is stronger than the 100,000-round server-side option and costs the Worker nothing.
- Stored parameters travel with the hash, so the rounds can be raised later. In this version a change of password re-derives with the current rounds (no silent upgrade at login).

### 2.2 Trade-offs, honestly

- The server cannot check password quality (length, blocklist, "not your username"): the app does. A modified client can set a weak password for its own account only; throttling still protects it. Accepted.
- A weak or buggy client could send a key derived with fewer rounds: the Worker refuses under 100,000 and malformed keys.
- The password is never sent, so it can't leak from server logs or a TLS-terminating proxy; the derived key is the equivalent secret and is treated like one (never logged).
- Every client must be able to run PBKDF2 (all browsers and the Tauri webview can).
- If the pepper is lost, every password is unusable: back it up.

### 2.3 Rejected

- **Server-side PBKDF2 at 100,000 rounds:** may exceed Free's 10 ms and is below OWASP.
- **Argon2/scrypt in WASM on the Worker:** more CPU and memory than Free allows.
- **Workers Paid:** ruled out by you.

### 2.4 Cost per login

On the Worker: one D1 read, one HMAC, one session insert, a couple of throttle writes. On the device: one PBKDF2 of about a second, once per login (not per request).

---

## 3. Sessions

Same design as the device token you already have, for every device: **random 32 bytes, only the SHA-256 stored, revocable, listed in Settings**. Token format `ptbs_<43 chars>` (the prefix lets secret scanners and log filters recognise it).

### 3.1 Cookie or bearer

| Client | Mechanism | Why |
|---|---|---|
| **Web and iPhone PWA** | **Cookie**: `__Host-ptb_session=<token>; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=<…>` | JavaScript (so any XSS) can never read it. It is also the only mechanism that works for `<img>` loads, which keeps option (b) of section 8 possible. It is set by the server, so Safari's 7-day cap on script-writable storage does not apply. |
| **Tauri desktop** | **Bearer** `Authorization: Bearer ptbs_…` stored in the app's local storage | Its origin is `tauri://localhost`, cross-origin to the Worker, so a `SameSite=Strict` cookie would not be sent. Bearer needs no CSRF protection because nothing is attached automatically. |

Both resolve to the same row in `sessions`. The Worker accepts either on every route; the response never echoes a token except once, in the login/signup answer for the bearer mode (and only to Tauri origins or a request with no Origin, i.e. tests/scripts).

### 3.2 CSRF (because cookies are used)

`SameSite=Strict` + `__Host-` prefix, and in addition every non-GET cookie-authenticated request must (1) carry `Content-Type: application/json` and a custom header `X-PTB: 1` (a cross-site form or simple request cannot set it, and a cross-origin `fetch` with it triggers a preflight the Worker doesn't allow), and (2) have an `Origin` header equal to the Worker's own origin (checked against the request URL; a missing Origin on a cookie request is refused). GET routes are read-only.

### 3.3 Lifetime, renewal, logout, revocation

- `expires_at` is **180 days from last use, capped at 1 year from creation**. A request renews it (and re-sets the cookie) at most once per day, so most requests do not write.
- **Every request looks the token up in D1** and joins `users.disabled`. A revoked or unlinked session (or a disabled user) therefore fails on its **very next request**. No caching, no JWT, nothing to wait out.
- `POST /api/auth/logout` (this session), `POST /api/auth/logout-all` (all of mine; also run by a password change or reset, except the session that changed it), and `DELETE /api/sessions {id}` from the device list in Settings.
- **Tokens are never logged, never in a URL, never in error text.** The Worker logs nothing of requests today and keeps that rule; the zod error messages are reduced to field paths. Tests grep the responses and the console for the token.
- Device list: name, kind (web/desktop), created, last seen. Max 20 sessions per account (oldest dropped on login).

### 3.4 What survives iOS clearing site data

A home-screen PWA has its own storage separate from Safari. **If iOS clears the site data, cookie and localStorage go together**: the person is logged out *and* the local teams are gone from that device. That is not new: it is exactly today's situation, and sync is the recovery (log in, everything comes back). The server session simply stays in the list until it expires or the person revokes it. Removing the PWA and re-adding it starts with no session: log in again, nothing is lost server-side.

---

## 4. Signing up (invite-only)

- **Invites:** random 12 symbols from the existing 32-symbol alphabet (no I/O/0/1; 60 bits), shown as `K7QM-3XWD-9PTR`. **Only the SHA-256 is stored.** Single use, expires after 7 days by default (1 hour–30 days), optional private note ("for Sam"). The code is shown **once** to the admin and is never listed again (the list shows note, created, expires, used-by, status).
- **Redeeming** is part of signup (`POST /api/auth/signup`): invite check, username check, password rules, create the user, create the session, return the recovery code (once). The invite is consumed in the **same D1 batch** that creates the user, so two simultaneous signups can't both win it. A wrong/expired/used invite gets one generic message.
- **Nobody can register without a valid invite**, including the first account (below).
- **First account:** the Worker has a secret `SETUP_CODE`. While `SELECT COUNT(*) FROM users` is 0, signup accepts `SETUP_CODE` instead of an invite and the new user gets `role='admin'`. After the first user exists, `SETUP_CODE` is ignored forever (delete the secret). Alternative rejected: "first signup wins" (a race on a public URL). Alternative kept as the fallback: a script `npm run admin -- bootstrap` that writes the first admin row with `wrangler d1 execute`.
- **Admin rights:** `users.role` is `admin` or `user`. Admins get a Settings → Account → **Admin** section and these endpoints: create/list/revoke invites; list users; disable/enable a user (also deletes their sessions); **reset a password** (issues a one-time reset code, section 5); promote/demote (only admins, never yourself out of the last admin). Each admin action writes a row to `events` (actor, kind, target; no secrets).
- **Without the app:** `npm run admin -- <invite|reset|disable|list>` (a small script over `wrangler d1 execute`, documented in `docs/ACCOUNTS.md` when built) so a locked-out admin is never stuck.

---

## 5. Recovery and changing a password

- **Recovery code**, shown **once** at signup (and again only when regenerated): 20 symbols from the same alphabet in groups of 5 (`ABCDE-FGHJK-LMNPQ-RSTUV`, 100 bits), with a "I saved it" checkbox before continuing, a copy button and a print-friendly view. Stored as a SHA-256 hash (high entropy, so a fast hash is correct here).
- **Using it:** `POST /api/auth/recover {username, recoveryCode, newPassword}`. On success: password replaced, **all sessions revoked**, a **new** recovery code issued and shown once, the old one dead. Throttled like login (section 6).
- **Admin reset:** admin creates a one-time reset code for a user (24 h, single use, stored as a hash); the user enters username + reset code + new password on the same screen. It also revokes all sessions. The admin never sees or sets the password.
- **Change password while logged in:** Settings → Account → needs the current password; revokes all other sessions, keeps this one.
- **Regenerate recovery code:** needs the current password.
- No e-mail anywhere in v1. If a person loses their password **and** recovery code, you reset them (they keep their data: the account is the same).

---

## 6. Abuse protection

**Throttling is in D1 counters, not only Cloudflare's rate-limit rules.** Reason: the existing `redeem_attempts` pattern already works from the first deploy, is covered by tests against a real SQLite, has no dashboard step, and counts exactly. Cloudflare's Workers Rate Limiting binding is per-location and eventually consistent, and WAF rate-limiting rules (free plan: one rule) are good as an outer layer, not as the thing the test suite can prove. So: **D1 counters as the guarantee (tested), plus one optional WAF rule on `/api/auth/*` as a cheap outer shield (Q14).**

Table `throttles(scope, key_hash, bucket, n)`; keys are `SHA-256(pepper + value)`, so no IP or username is stored in the clear; old buckets are deleted as new ones start. The client address is `CF-Connecting-IP` (IPv6 reduced to its /64).

| Action | Per IP | Per username (or per user) |
|---|---|---|
| Login | 20 attempts / 10 min | 8 **failures** / 15 min, then `429` + `Retry-After` for that username |
| Signup / invite redemption | 10 / 10 min, and 5 **wrong invites** / hour | n/a |
| Recovery / reset code | 10 / hour | 5 / hour |
| Friend request by username | n/a | 30 / day per requester |
| Friend-link redemption | 10 / 10 min | n/a |

Known trade-off: the per-username limit lets someone who knows a username keep it locked for 15-minute windows. With ~10 people and invite-only that is acceptable; being logged in on a device is unaffected (a session doesn't depend on the login throttle), and the owner can always reset.

Other rules:

- **Generic errors:** login says "Wrong username or password" for unknown user, wrong password and disabled account alike; recovery says "That code doesn't work"; invites say "That invite isn't valid". Same status code and shape.
- **Account enumeration:** signup must say a username is taken (unavoidable), but only after the invite is accepted and only to a holder of a valid invite. Friend requests by username answer the same ("If that person exists they'll see your request") whether or not they exist.
- **Username:** 3–20 chars, `a-z A-Z 0-9 _ . -`, starts with a letter or digit, **case-insensitive unique** (`username_key` is the lower-case form; the typed case is shown), a small reserved list (`admin`, `root`, `support`, `system`, `ptb`, …), no confusable spaces or Unicode.
- **Password:** 10–128 characters (NFKC), no composition rules, must not equal or contain the username, **blocklist of ~200 common passwords** (server-side; the client shows the same hint). The strength hint on the form is advisory only.
- **Timing:** unknown user costs the same PBKDF2 as a known one (section 2.3).
- **Size limits:** auth bodies are capped at 2 KB, admin/friend bodies at 4 KB, the sync routes unchanged.
- **Captcha/Turnstile:** rejected as over-engineering for an invite-only app of 10.

---

## 7. Removing Access

### 7.1 Routes after the change

| Route | Before | After |
|---|---|---|
| Static app (`/`, JS, data, sprites) | Access | **Public** (but see section 8) |
| `GET /api/health` | Access | **Public**, reduced to `database` + `migrations` + `missing` + time (no Access flags) |
| `POST /api/auth/signup`, `/login`, `/recover` | n/a | **Public**, throttled, CORS for Tauri origins |
| Everything else under `/api/*` (`sync`, `shared`, `shares`, `me`, `sessions`, `friends`, `admin`, `claim`) | Access JWT | **Session required** (cookie or bearer) |
| `/api/device/*`, `/api/pair`, `/api/devices` | Bypass + pairing | **Removed** in the last PR |
| `GET /api/session/renew` | Access re-login | **Removed**; the in-app login dialog replaces it |

### 7.2 Things that go away (last PR, after your go-ahead)

- `worker/auth.ts` (JWT verification), `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and their health/`notSetUp` handling.
- `worker/devices.ts` pairing codes, `src/domain/pairing.ts`, `src/sync/pairing.ts`, `LinkDevices.tsx`, `pair_codes`, `redeem_attempts`, the `devices` table (after its rows are migrated to `sessions` or dropped).
- The "sign in again" banner copy: it stays, but its button opens the **in-app login dialog** (no navigation to Access, no `/api/session/renew`). `RENEW_PATH` and `signInAgain()` go.
- The service-worker rule `navigateFallbackDenylist: [/^\/api\//]` **stays** (a navigation to `/api/...` should still reach the network), it just no longer exists for Access's sake.
- The **Access bypass application** for `/api/device/*` and the main Access application: you delete them by hand, last.

### 7.3 Deploy order so nobody is locked out

The Worker has an `AUTH_MODE` variable: `access` (today, default) → `both` → `accounts`.

1. Migration + code with the new routes **off** (`AUTH_MODE=access`). Nothing changes for anyone.
2. `AUTH_MODE=both`. Access is still in front of everything, so only you can reach it. Create your admin account, claim your data (section 9). The sync identity is "session if present, else Access JWT mapped to the claimed account, else the Access e-mail as today".
3. Test on iPhone, web and desktop, still behind Access.
4. **Go-live (by hand):** in Zero Trust, change the Access policy to **Bypass / Include Everyone** (or disable the application; both are one click and reversible). Friends can now reach the site and sign up with your invites. Access has not been deleted.
5. A week of use. Old Access-only desktop devices and pairing still work in `both`.
6. Last PR removes the legacy code (`AUTH_MODE` gone). **Then** you delete the two Access applications and the `ACCESS_*` variables.

Rolling back at steps 2–5 is `AUTH_MODE=access` plus re-enabling the Access policy; the claimed data stays valid for either (section 9.3).

---

## 8. The app's own files and the game art

### 8.1 What is in the bundle

- `public/sprites/*` ≈ **16 MB** of Pokémon sprite atlases and item/TM icons (built from PokeAPI's sprites, i.e. Nintendo/Game Freak/The Pokémon Company artwork).
- `public/maps/*` ≈ **0.6 MB** of town/route maps rebuilt from the pret disassemblies plus hand-placed schematics.
- JS/CSS, data (stats, learnsets, trainers, encounters, text), and the PWA precache lists all of it (≈44 MB total with the Atlas files).

### 8.2 Honest assessment

The Pokémon names, stats, moves and encounter tables are facts and largely reproduced by Showdown, Bulbapedia and PokeAPI everywhere. The **sprites and map art are copyrighted artwork**, and so are the item icons. Today they are only served to people who pass Access. Publicly served, that is hosting copyrighted images: the same practice as Showdown, PokeAPI and countless fan tools, widely tolerated, and also exactly what Nintendo/TPC send takedown notices about. The realistic risk to you is **a DMCA notice to Cloudflare or GitHub about the account/repository**, not a lawsuit against ten friends; it is higher the easier the files are to find (search indexing, a guessable URL). This is not legal advice.

### 8.3 Options

| | What it does | Cost for offline/PWA |
|---|---|---|
| **(a) Accept, harden discoverability** | `X-Robots-Tag: noindex, nofollow` and `robots.txt: Disallow: /` in `public/_headers`, `preview_urls` stays off, the `workers.dev` URL stays unlisted, no custom domain advertised. | None. Offline and precache are untouched. |
| **(b) Serve sprites and maps only to sessions** | `run_worker_first: ["/api/*", "/sprites/*", "/maps/*"]`; the Worker checks the session cookie and then `env.ASSETS.fetch`. The art is never reachable without a login. | The PWA install would precache 16 MB with credentials only after login; before login (first run, "works without an account") the app would show placeholders instead of sprites; the precache must move from "everything at install" to "after login" (a workbox change). The Tauri desktop bundles its own files and is unaffected. |
| **(c) Strip or replace the art** | Ship generic silhouettes/text; users bring their own sprite pack. | Large product change; rejected. |

**Recommendation: (a) now**, written into PR 1's headers, and **(b) as a ready follow-up PR** if you want it (it is why the web session is a cookie). Reason: (b) breaks the "opens and works with no account" requirement for the first run and complicates the precache, while its legal value is mostly *not being indexable*, which (a) gives for free; friends receiving the files is the same in both. If you would rather be strict, say so (Q8) and I will put (b) in the order.

---

## 9. Migrating existing data: "Claim my data"

### 9.1 The mechanism

Teams and matches are keyed by the Access e-mail in `owner`. New accounts have an id (`u_` + 12 random chars). A one-time **claim** moves everything from the e-mail to the id.

- Allowed only in `AUTH_MODE=both` (so while Access is still valid) and only when **one request carries both** a valid session (the new account) **and** a valid Access JWT (the old identity) and the account is **fresh** (no documents, no `sync_seq`, no shares, `legacy_email IS NULL`). The e-mail comes from the verified JWT, never from the body.
- `POST /api/claim` runs **one `db.batch`** (D1 batches are transactions, so it is all or nothing):
  `UPDATE documents SET owner=:id WHERE owner=:email`, `sync_seq`, `shares.owner`, `shares.grantee`, `devices` (old desktop tokens keep working, now for the account), `pair_codes`, `profiles` → `users.display_name`, then `users.legacy_email = :email` (unique) and a row in `account_claims (user_id, legacy_email, at, docs, shares, devices)` for audit/rollback.
- **Intact:** `documents` rows are the same rows with only `owner` rewritten, so ids, `updated_at`, tombstones, `group_id`, and **`server_seq` are untouched**; `sync_seq.value` moves with them. So every client's stored cursor and `known` map stay valid and **nothing is re-pulled or turned into a conflict copy**; shares keep their rows (and so do the shared teams' conflict copies, which live in the grantee's own documents).
- Ordering matters: the app **blocks sync for a new account until it has either claimed or skipped** (a "Bring my teams from before" screen right after signup), because sync before claiming would create a non-empty account that can't claim. Friends with no old data press Skip.
- **Desktop, which can't pass Access:** claim from the web first (the desktop's old device token belongs to the e-mail, so it moves with the account). The desktop then logs in with the username and password (its old `ptbd_` token keeps working until the last PR, then the app asks it to log in once; the data is already the same).
- **Fallback if Access is already gone:** `npm run admin -- claim <email> <username>` (does the same batch from a trusted shell, after a backup). Needed because a friend's old data would otherwise be orphaned.

### 9.2 Backup first

There is **no weekly backup workflow in the repository today** (Q11); `docs/SYNC.md` documents `wrangler d1 export` and Time Travel (30 days). PR 4 adds `.github/workflows/d1-backup.yml` (weekly + manual; export → `age`-encrypted file → private artifact, 30 days; needs the secrets `CLOUDFLARE_API_TOKEN` (D1 read) and `AGE_PUBLIC_KEY`) and a bold step in the PR description: **run `npx wrangler d1 export pokemon-team-builder --remote --output backup.sql` before the first claim.** The admin script refuses to claim unless a backup file path is given.

### 9.3 Rollback

- **A claim:** `npm run admin -- unclaim <username>` reverses it from `account_claims` (rewrites `owner` back to the e-mail in one batch). Until the last PR the old code reads e-mail owners, so `AUTH_MODE=access` works for an unclaimed account at once.
- **A whole step:** `AUTH_MODE=access` (instant, a dashboard variable), re-enable the Access policy. Nothing in the new tables is read in that mode.
- **Worst case:** restore the D1 backup / Time Travel to the time before the claim.
- **Side by side:** `both` runs both systems; an account that hasn't claimed behaves exactly as today.

---

## 10. Sharing and the friend list

### 10.1 Sharing moves to account ids

`shares.owner` and `shares.grantee` hold **user ids** (after a claim, the rewritten e-mails). The API and UI show **usernames/display names**, never e-mails. A shared document query joins `users` and skips disabled owners and grantees. The access matrix (`worker/access.ts`) is untouched: it already compares opaque strings.

### 10.2 Friends

Small, deliberately: **request → accept**, no feeds, no presence.

- **Add by username** (typed): `POST /api/friends/request {username}`. The answer is always the same neutral line. The other person sees a pending request (their Friends list, a dot on Settings).
- **Add by friend link/code:** `POST /api/friends/link` makes a single-use, 7-day code (`FR-XXXXX-XXXXX`, hash stored) the owner sends over any chat; whoever redeems it becomes a friend **immediately** (the owner created it for that purpose) — no username needed, and nothing can be sniffed from guessing names. The code is typed/pasted, not put in a URL.
- **Accept/decline** (`POST /api/friends/respond`), **remove** (`DELETE /api/friends`), **block** (`POST /api/blocks`, `DELETE /api/blocks`): a blocked person's requests are silently dropped and they can't re-request; blocking removes any friendship.
- **What a friend sees:** username, display name. Nothing else, until you share something.
- **Sharing a team or the match log** (the existing Share dialog) picks **from the friend list**; the server refuses a grant to a non-friend.
- **When a friendship ends** (remove or block), in one batch: every share in both directions between the two is deleted; their shared copies vanish at their next sync (the existing "stop sharing" behaviour). Copies they made with "Make my own copy" stay theirs.
- **When an account is disabled:** its sessions are deleted at once; its shares stay in the table but are excluded from every query (so re-enabling brings them back); it disappears from friends' lists as "unavailable". Permanent deletion of a user (admin script) purges the user's documents, shares and friendships.
- Limits: 100 friends, 20 pending requests, 50 shares (existing) per account.

---

## 11. Desktop (Tauri) and iPhone PWA

### 11.1 Where the session lives

| | Web / iPhone PWA | Desktop |
|---|---|---|
| Session | HttpOnly cookie (not readable by the app's JavaScript) | `ptbs_` token in the app's local storage (`ptb:session:v1`, replaces `ptb:device:v1`) |
| Keychain? | n/a | **Not in v1.** Tauri has no first-party keychain plugin in this repo's dependency list (`tauri-plugin-log`, `-updater`, `-process`); a community plugin or the `keyring` crate adds Rust code, a capability and a Linux secret-service dependency across three OS builds. The trade-off is the same as today's `ptbd_` token: anything that can read the app's data folder as the same user can act as that session until it is revoked, and the teams stored next to it are readable anyway. A keychain would protect only the token. Revisit if you want it (Q9). |
| Server address | same origin | typed once ("Your app address"), remembered (already the behaviour of `deviceStore`) |

### 11.2 First run and offline-first

- **The app always opens and works with no account.** localStorage stays the source of truth; nothing about teams, the calculator or the Pokédex ever waits for a session. No login wall.
- Settings → **Account**: *Create account* (invite code + username + password) and *Log in* when signed out; account name, devices, password, recovery, log out when signed in.
- A friendly one-time card on first run ("Make an account to sync and share; you can do this later"), dismissible.
- **"Sync off" now means** "this device doesn't send or receive teams", independent of being logged in. Being logged out and having sync on shows the existing banner ("Sign in again") which opens the login dialog; local edits keep accumulating and are sent after login. Logging out keeps the local data and turns sync off on that device (it can be turned on again after logging in).
- The login form uses `<form>`, `name`/`id` `username` and `password`, `autocomplete="username"`, `autocomplete="current-password"`/`"new-password"`, `type="password"`, 16 px inputs, 44 pt targets, no overflow at 320–430 px (docs/UI.md).

---

## 12. Data model and API

### 12.1 Migrations (EXPECTED_MIGRATIONS gets each name; the test keeps it in step)

`0005_accounts` (additive only, safe to run before any code uses it):

```
users(id TEXT PK, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE, display_name TEXT,
      role TEXT CHECK(role IN ('user','admin')) DEFAULT 'user', disabled INTEGER DEFAULT 0,
      pw_hash TEXT NOT NULL, pw_changed_at INTEGER, recovery_hash TEXT NOT NULL,
      legacy_email TEXT UNIQUE, invited_by TEXT, created_at INTEGER NOT NULL)
sessions(id TEXT PK, user_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT CHECK(kind IN ('web','desktop')),
         token_hash TEXT NOT NULL UNIQUE, created_at, last_seen_at, renewed_at, expires_at)  -- index on user_id
invites(code_hash TEXT PK, created_by TEXT, note TEXT, created_at, expires_at, used_by TEXT, used_at, revoked_at)
reset_codes(code_hash TEXT PK, user_id TEXT, kind TEXT, created_by TEXT, expires_at)
throttles(scope TEXT, key_hash TEXT, bucket INTEGER, n INTEGER, PRIMARY KEY(scope,key_hash,bucket)) WITHOUT ROWID
events(id INTEGER PK AUTOINCREMENT, at, actor, kind, target)           -- admin audit; no secrets
credentials(id, user_id, kind, public_key, counter, created_at)       -- reserved for passkeys (v1.1), unused in v1
```

`0006_friends`: `friendships(a, b, state, requested_by, created_at, updated_at)` (a < b so a pair has one row), `blocks(blocker, blocked)`, `friend_links(code_hash PK, owner, expires_at, used_by, used_at)`.

`0007_claims`: `account_claims(user_id, legacy_email, at, docs, matches, shares, devices)`.

The final PR adds `0008_drop_legacy` (`pair_codes`, `redeem_attempts`, `devices`, `profiles`), applied after a backup.

### 12.2 Endpoints (zod for every body; sizes in section 6)

Public: `POST /api/auth/signup`, `/login`, `/recover`; `GET /api/health`.
Session: `POST /api/auth/logout`, `/logout-all`; `GET /api/me`, `PUT /api/me {displayName}`, `POST /api/me/password`, `POST /api/me/recovery`; `GET/DELETE /api/sessions`; `POST /api/claim` (both mode only).
Friends: `GET /api/friends` (friends, incoming, outgoing, blocked, with usernames), `POST /api/friends/request`, `/respond`, `/link`, `/link/redeem`, `DELETE /api/friends`, `POST/DELETE /api/blocks`.
Admin (role check on every call): `GET/POST/DELETE /api/admin/invites`, `GET /api/admin/users`, `POST /api/admin/users/disable|enable|reset|role`.
Unchanged: `/api/sync`, `/api/shared`, `/api/shares` (grantee becomes a user id, verified as an accepted friend), `/api/profile` (folded into `PUT /api/me`).

### 12.3 Health

`GET /api/health` keeps `database`, `migrations`, `missing`, `time` and replaces `access: {teamDomain, audience}` with `accounts: {mode, pepper: boolean, setupOpen: boolean}` (booleans only). `healthLine` says what is missing (`PASSWORD_PEPPER not set`, `Database migration missing: 0005`). During `both` the Access flags are still reported.

---

## 13. Test plan

**Unit/worker tests** (the existing real-SQLite harness `worker/__tests__/d1shim.ts`):

- Hashing: stored format, parameters read back, salt unique, the same password gives different hashes, pepper matters (wrong pepper fails), constant-time helper, upgrade-on-login rewrites an old `i`, unknown user costs the same path, NFKC.
- Throttling: each row of the table in section 6, buckets roll over, the per-username lock does not stop an existing session, hashed keys only (no IP/username in the table).
- Sessions: token stored hashed; **revoke → the very next request is 401**; disabled user → 401; logout-all; password change revokes the others; sliding renewal writes at most once a day; expiry; max 20; token absent from every response except the one allowed, from `console`, from URLs.
- Cookie flags and CSRF: missing `X-PTB`, wrong Origin, missing Origin, cross-origin form content type all refused; bearer needs none.
- Invites: single use under concurrency (two signups, one wins), expiry, revoke, rate limit, generic error, first-account `SETUP_CODE` works only at zero users.
- Recovery/reset: one-use, expiry, revokes sessions, issues a new recovery code.
- Claim: moves documents/sync_seq/shares/devices atomically, `server_seq` and cursors intact (an engine test pulls with the old cursor and gets nothing new), refuses a non-fresh account, refuses without the Access JWT, unclaim restores, claim twice refused.
- Friends and shares: request/accept/decline/remove/block; sharing requires a friendship; removal and block delete shares both ways; a disabled account's shares vanish and return on enable; no enumeration difference between unknown and existing usernames; the access matrix (`access.test.ts`) unchanged.
- Migration list: `EXPECTED_MIGRATIONS` matches the folder; the health line.

**e2e (Playwright, desktop Chromium and iPhone WebKit; axe on every new screen):** sign up with an invite, recovery-code screen, log out/in, a wrong password message, the sign-in banner opening the login dialog, offline start with no account, device list and revoke, admin invite creation, friend request/accept/remove, no overflow 320–430 px, inputs are 16 px, password-manager attributes present. `e2e/navigation.spec.ts` gets any new route.

### Threat model

| Threat | What an attacker gets | Control |
|---|---|---|
| **Stolen or lost device** | A logged-in session on that device. | Revoke it from another device (effective on its next request), "log out everywhere", server sessions are revocable and expire; password change kills the rest. |
| **Stolen D1 backup** | Usernames, hashes, session hashes, documents (teams are not secrets from the owner but are private). | Password hashes are peppered (the secret isn't in D1), salted, PBKDF2; session/invite/recovery values are only hashes of 60–256-bit randoms, useless to reverse. Backups are age-encrypted. |
| **Brute force / credential stuffing** | Nothing without lucky guesses. | Per-IP and per-username D1 throttles, blocklist, 10+ char minimum, optional WAF rule; 429 with Retry-After. |
| **Invite leakage** | Someone registers. | 60-bit codes, hash only, single use, 7-day expiry, revocable, redemption throttled, admin sees who used which invite and can disable. Not in URLs. |
| **CSRF** | Actions as a logged-in web user. | `SameSite=Strict`, `__Host-`, custom header + Origin check, JSON only. |
| **XSS** | Would act as the user in-page. | Cookie is HttpOnly (token can't be exfiltrated); strict CSP (`script-src 'self'`) already; React escaping; display names are plain text. Desktop token in localStorage is readable by XSS: accepted, same as today. |
| **Account enumeration** | Which usernames exist. | Generic login/recover/invite errors, constant work for unknown users, neutral friend-request answer; signup reveals "taken" only to a valid invite holder. |
| **Malicious friend** | Spam requests, trying to read more than shared, a shared team that is huge or hostile JSON. | Request caps and blocks; the access matrix and server checks on every read/write (a friend sees nothing until shared; edit role never deletes the top-level team); shared documents are sanitised on write by the same sanitisers; remove/block revokes at the next request. |
| **Admin account takeover** | Everything. | It is a normal account with the same protections, plus re-entering the password for admin actions that create resets; every admin action is in `events`. |
| **Lost pepper / `SETUP_CODE` left set** | Lockout / nothing (it works only at zero users). | Documented backup of the pepper; delete `SETUP_CODE` after the first account. |
| **Public static files** | Anyone can fetch the art/data. | Section 8. |

---

## 14. Work breakdown (one small PR each, in this order)

Every PR: typecheck, unit + worker tests, lint, build, e2e where UI changes, CHANGELOG, one `npm run bump`, and a description listing hand steps. Access stays on until PR 8. The numbers in brackets are the section above.

| PR | Contents | What you do by hand |
|---|---|---|
| **1. Schema + auth core, flag off** | `0005_accounts`; `worker/password.ts`, `sessions.ts`, `throttle.ts`, `invites.ts`; `/api/auth/*`, `/api/me`, `/api/sessions` behind `AUTH_MODE` (default `access` = routes answer 404); `Server-Timing` on login; noindex headers [8]; tests [13]; `docs/ACCOUNTS.md` | Add secrets `PASSWORD_PEPPER` (32+ random bytes, **also save it in your password manager**) and `SETUP_CODE`. Confirm the Paid plan (Q1). The migration applies itself on deploy. Nothing changes for users. |
| **2. Login/signup UI** | Settings → Account (signup, login, recovery, change password, device list, logout), the in-app login dialog, `http.ts` accepts a session, `ptb:session:v1` for desktop; sync still uses Access | Set `AUTH_MODE=both`. Create your account with `SETUP_CODE`, **save the recovery code**, delete `SETUP_CODE`. Test on phone, web, desktop. |
| **3. Admin: invites and users** | Invites, users list, disable, reset, `events`; `npm run admin` script | Create an invite for yourself on a second device to test. |
| **4. Claim my data + backups** | `0007_claims`; `POST /api/claim` + "Bring my teams from before" screen; `unclaim`; `d1-backup.yml`; admin `claim` fallback | **Run `wrangler d1 export` and keep the file.** Add `CLOUDFLARE_API_TOKEN` + `AGE_PUBLIC_KEY` secrets in GitHub (Q11). Claim your own account while still behind Access. Check teams, matches, shares, desktop. |
| **5. Switch sync and sharing identity** | Sync/shared/shares resolve the user from the session (Access JWT maps to the claimed account); shares keyed by id and shown by username; disabled-user filtering | Check a second device syncs with no conflict copies. |
| **6. Friend list** | `0006_friends`; Friends screen, requests, link, block; the Share dialog picks from friends; share cleanup on remove/block/disable | Add one friend (a second test account of yours first). |
| **7. Go-live (mostly your hands)** | A small PR: docs and the "invite a friend" instructions; optional WAF rule notes | In Zero Trust set the Access policy to **Bypass** (reversible). Optional: add the WAF rate-limit rule on `/api/auth/*`. Send invites. Watch for a week. |
| **8. Remove Access** (needs your explicit go-ahead) | Delete `worker/auth.ts`, `ACCESS_*`, pairing, `/api/device/*`, `/api/session/renew`, `devices`/`pair_codes`/`redeem_attempts` (`0008`), `AUTH_MODE`, the Access wording in docs; health simplified | After merge and deploy: delete the **Access application and the bypass application** and the `ACCESS_*` variables. Later, delete unclaimed legacy rows if you want (Q13). |

Optional, later: passkeys (v1.1), art gating (b) if you choose it (Q8), keychain on desktop (Q9).

---

### Decisions I need from you before PR 1

Q1 (Workers plan) matters most; Q7 and Q8 are the other two where your preference actually changes the build. Everything else you can answer "default".
