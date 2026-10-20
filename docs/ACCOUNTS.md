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

Bodies are zod-validated (`src/domain/accounts.ts`) and capped at 2 KB.

## Sessions

- A random 32-byte token (`ptbs_…`); **only its SHA-256 is stored** (`sessions`). Every request looks it up in D1 joined with the user, so a revoked session, a disabled user or an expired token fails on the next request.
- Web / phone app: the cookie `__Host-ptb_session` (HttpOnly, Secure, SameSite=Strict). Desktop app: `mode: "token"` in the login body gets the token back and sends it as `Authorization: Bearer`; only requests from the desktop webview's origins can ask for that.
- Lifetime 180 days from last use (renewed at most once a day, and the cookie re-set), never more than a year from creation. At most 20 sessions per account.
- **CSRF:** a cookie request that changes something, and every login/signup/recover, must come with `Origin` equal to the site (or a desktop origin) and the header `X-PTB: 1`. Bearer requests need neither.

## Passwords (`worker/password.ts`)

**The password never reaches the Worker.** Workers Free allows 10 ms of CPU per request, which a server-side PBKDF2 (capped at 100,000 rounds there) may not fit, and the plan must not need the paid tier. So the slow step runs on the person's device: `deriveKey` (`src/domain/accounts.ts`) computes PBKDF2-HMAC-SHA256 of the NFKC password with a per-user 16-byte salt and **600,000 rounds** (OWASP's number; about a second on a phone) and sends the 32-byte result, not the password. The Worker stores `ckdf-pbkdf2-sha256$i=…$p=…$salt$mac`, where `mac` is HMAC-SHA256(`PASSWORD_PEPPER`, key) (`worker/password.ts`), and compares in constant time: a few microseconds of CPU. A stolen database has MACs it can't test guesses against without the pepper, and each guess would cost 600,000 rounds.

`POST /api/auth/params {username}` returns the salt and rounds to derive with. A name that doesn't exist gets a stable, real-looking salt derived from the pepper and the name, so it reveals nothing. A new password is set by sending a new salt and key (signup, recovery, password change). The server refuses fewer than 100,000 rounds and malformed keys.

Because the server never sees the password, the length, blocklist and username rules (`passwordProblem`) are checked by the app; a modified client could set a weak password for its own account, which only weakens that account, and the throttles still apply. The rounds can be raised later (the stored value carries them); there is no automatic upgrade at login in this version, changing the password does it.

## Throttling (`worker/throttle.ts`, table `throttles`)

D1 counters, keyed by a hash of the pepper, the scope and the client address / username, in fixed windows: login 20 per 10 minutes per address and 8 failures per 15 minutes per username; signup 10 per 10 minutes and 5 wrong invites per hour per address; recovery 10 per hour per address and 5 per hour per username; password checks 8 per 15 minutes per account. The address is `CF-Connecting-IP` (IPv6 reduced to its /64). Answers are `429` with `Retry-After`. Login, recovery and invites answer identically whatever is wrong.

## Invites (`worker/invites.ts`)

12 symbols (60 bits) from the unambiguous alphabet, shown as `K7QM-3XWD-9PTR`, single use, 7 days by default, only the SHA-256 stored. The invite is consumed in the same D1 batch that creates the user, so two signups racing for one invite can't both win. Creating invites from the app is a later step; until then they are made with `createInvite` (tests) or SQL.

## Tables (`migrations/0005_accounts.sql`)

`users`, `sessions`, `invites`, `reset_codes`, `throttles`, `events` (admin audit, no secrets) and `credentials` (reserved for passkeys, unused). Nothing reads them while `AUTH_MODE` is `access`.

## Tests

`worker/__tests__/accounts.test.ts`: rules, hashing parameters, the routes being off by default, first account and invites (single use, expiry, revoke, race), login answers and throttles, rehash on login, token mode, sessions (hash only, revoke on the next request, logout everywhere, disabled, expiry, renewal, the limit), CSRF, password change and recovery, no secrets in console output.
