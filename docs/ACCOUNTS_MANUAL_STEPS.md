# Accounts rollout: what you do by hand

The code ships in small PRs (docs/ACCOUNTS_PLAN.md section 14). Every merge deploys by itself and is safe with the default `AUTH_MODE=access` (today's behaviour: nothing new is reachable). The steps below are the only things the code cannot do. Do them in this order, when you are home. docs/ACCOUNTS.md says how each piece works.

Tick each box; *Check* says how to know it worked. Every step up to D can be undone (see "Rolling back" at the end).

## A. Before turning anything on (once)

- [ ] **Stay on the Workers Free plan; nothing to buy.** The slow password hashing runs on the device, so the Worker spends well under the Free plan's 10 ms of CPU per request.
      *Check (after your first login):* Workers & Pages → pokemon-team-builder → Metrics shows no "exceeded CPU" errors.
- [ ] **Set the Worker secrets** (Workers & Pages → pokemon-team-builder → Settings → Variables and Secrets → Add, type **Secret**):
  - `PASSWORD_PEPPER`: 32+ random characters (for example `openssl rand -base64 48`). **Save a copy in your password manager.** If it is lost, every password is unusable and each user needs an admin reset.
  - `SETUP_CODE`: any long random string. It is used once, to create the first (admin) account.
  *Check:* Settings → Sync (or `/api/health`) no longer says `PASSWORD_PEPPER not set`.
- [ ] **Deploy command must be `npm run deploy`** (Workers & Pages → pokemon-team-builder → Settings → Build → Deploy command; `npx wrangler deploy` deploys the code but never creates the new tables), and the build token needs **Account → D1 → Edit** (docs/SYNC.md). After changing it: Deployments → latest → *Retry build*. The migrations `0005_accounts`, `0006_claims` and `0007_friends` apply themselves on deploy. *Check:* Settings → Sync says *Server ready* (not *Database migration missing*).
- [ ] **Weekly backups.** GitHub repo → Settings → Secrets and variables → Actions → New repository secret:
  - `CLOUDFLARE_API_TOKEN`: Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom token, permission **Account → D1 → Edit** (export counts as a write: **Read is not enough**), Account Resources: Include → your account.
  - `AGE_PUBLIC_KEY`: run `age-keygen -o key.txt` (install `age` first: `winget install FiloSottile.age`, `brew install age`, `apt install age` or the releases page); it prints `Public key: age1…`. That `age1…` value is the secret. **Put the whole of key.txt (the `AGE-SECRET-KEY-…` line) in your password manager** (without it the backups can't be opened) and delete the file.
  - `CLOUDFLARE_ACCOUNT_ID`: **always needed** (a custom token can't look the account up by itself). It's the 32-character code in the dashboard's address bar, `dash.cloudflare.com/<this>/…`, also shown as *Account ID* on the Workers & Pages page.
  *Check:* Actions → **D1 backup** → *Run workflow*; the run ends with a `d1-backup` artifact (an `.age` file). It then runs every Monday.
- [ ] **Back up D1 by hand now** (a terminal in the repo, `npx wrangler login` first): `npx wrangler d1 export pokemon-team-builder --remote --output backup-before-accounts.sql`. Keep the file somewhere safe until the rollout is over.

## B. Turn the accounts on for yourself (still behind Access)

Do this **in the browser or phone app where you are signed in through Cloudflare Access** (the website or the installed iPhone app), not the desktop app.

- [ ] Workers & Pages → pokemon-team-builder → Settings → Variables and Secrets → Add, type **Text**: `AUTH_MODE` = `both` (`keep_vars` keeps it across deploys). Wait for it to save.
- [ ] In the app: Settings → Account → **Create account** → `SETUP_CODE` in *Invite code*, a username, a password. **Save the recovery code** it shows (once only: *Copy code*, then tick *I saved it*, then *Continue*).
- [ ] Right after, the app shows **Bring my teams from before**: it names your Access e-mail and how many teams, matches, shares and linked desktop apps it will move. Press **Bring them over**. (Don't press *Skip*: that is for accounts with nothing from before. If you did, it is still there, folded, in Settings → Account while the account has nothing of its own.)
      *Check:* your teams, match log and shares are all there; no "Conflict copy" appeared; *Sync now* works.
- [ ] **Delete the `SETUP_CODE` secret.**
- [ ] Log in on your other devices: the phone and the website (whichever you didn't use), and the desktop app (Settings → Account; it asks for *Your app address* the first time; it reaches the Worker through `/api/device/*`, which Access already lets through, so nothing changes in Access). The desktop app syncs through its login from then on; its old pairing link keeps working until step E, and you can *Unlink this desktop app* in Settings → Sync once it is logged in.
      *Check:* Settings → Account → Devices lists every device; each says *Last synced …* with no "Conflict copy"; a team edited on one shows up on the others.
- [ ] Try *Sign out* on one device from another. *Check:* the signed-out device shows *Your sign-in has expired* at the top (the next time the app starts or you open Settings → Account; the desktop app also at its next sync), and *Sign in again* logs it back in without leaving the screen.

## C. Try it with a second account, and bring friends' old data over

- [ ] Settings → Account → **Admin** → *Make an invite* (note "test"), then on a second device or a private window: *Create account* with that code as a test user, and *Skip* when it offers teams from before. *Check:* the invite shows *Used by <name>*; Admin → Accounts lists both.
- [ ] Settings → **Friends**: add the test account by username (it accepts under its Settings → Friends; a dot on *More* tells it), or make a friend code and enter it there. Share a team with it (Saved teams → share → pick the friend). *Check:* the test account sees the team after its next sync. Then *Remove* the friend: the shared team disappears from the test account at its next sync.
- [ ] On the test account try *Disable* (it is signed out at once), *Enable*, and *Reset password* (asks for your own password; the code works once under *Forgot password?*).
- [ ] Try the command line once, so you know it works when you need it: `npx wrangler login`, then `npm run admin -- list` (the `old_data` column says `claimed`, `skipped` or `pending` for each account).
- [ ] **Friends who used the app before accounts** (their teams are under their Access e-mail): send each an invite code (Admin → *Make an invite*), and have them make their account **in the browser where they are signed in through Access**, then *Bring them over*, before step D. Anyone who misses it: after a backup, `npm run admin -- claim <their e-mail> <their username> --backup backup.sql` does the same from your terminal (also after step D). People who shared with each other through Access are friends automatically once both have claimed.

## D. Go live (lets friends in)

- [ ] *Check first:* `npm run admin -- list` shows `claimed` or `skipped` for everyone who had data before (anyone left can still be done later with `npm run admin -- claim`).
- [ ] Set `AUTH_MODE` = **`accounts`**. From now on a new account has nothing to bring over (no *Bring my teams from before* step), and claims go only through `npm run admin -- claim`. Sign-in through Access keeps working for as long as Access still adds its token (until the next step), so nothing breaks yet.
      *Check:* your devices still sync (*Sync now*).
- [ ] **Access → Bypass.** Cloudflare Zero Trust → Access → Applications → your app (the one for the whole site) → Policies → Add a policy: action **Bypass**, *Include: Everyone*. Save. (Bypass policies are evaluated before Allow ones. Turning the application off works too.) Reversible in one click. Do **not** delete the applications yet, and leave the `/api/device/*` bypass application as it is.
      *Check:* a private window opens `https://<your-worker>/` without an Access login; `https://<your-worker>/api/sync` answers `401 {"error":"not signed in"}`; `https://<your-worker>/api/health` answers JSON with `"mode":"accounts"`; your own devices still sync.
- [ ] (Optional, recommended) **A WAF rate-limiting rule** as an outer shield over the Worker's own limits. Cloudflare dashboard → your domain or the workers.dev zone → Security → WAF → Rate limiting rules → Create rule (the Free plan allows one rule):
  - *If incoming requests match:* custom expression `(starts_with(http.request.uri.path, "/api/auth/") or starts_with(http.request.uri.path, "/api/device/auth/"))`
  - *Characteristics:* IP; *Requests:* 20; *Period:* 10 seconds; *Action:* Block; *Duration:* 10 seconds.
  The labels may be worded a little differently in your dashboard (I couldn't open Cloudflare's docs from here); what matters is the path match, per IP, about 20 per 10 seconds. A workers.dev address may not offer WAF rules at all; then skip this, the Worker's own limits still apply.
      *Check:* log in once normally; it still works.
- [ ] **Invite your friends.** Settings → Account → **Admin** → *Make an invite* (the note is only for you, e.g. "for Sam"). Send them the **code** (it looks like `K7QM-3XWD-9PTR`), never a link, with the app's address. They open the address (on iPhone: Share → Add to Home Screen), Settings → Account → *Create account*, enter the code, a username and a password, and **save their recovery code**. An unused invite can be revoked in Admin; each one works once and expires (7 days by default).
- [ ] Add them in Settings → **Friends** (by username, or send a friend code); share a team to check.
- [ ] Watch for a week: Admin → Accounts (last seen), Workers Metrics (errors, CPU), and the weekly D1 backup run.

## E. Remove Access (only after you tell me to; the last PR)

- [ ] Wait about a week of normal use with Access on Bypass.
- [ ] Tell me "go" and I make and merge the final PR (removes the Access code, pairing, `/api/device/*`, `/api/session/renew` and `AUTH_MODE`; the desktop app moves to `/api/` and asks to log in once if it was still only paired).
- [ ] After that deploy: Zero Trust → Access → Applications → **delete** the main application **and** the `/api/device/*` bypass application.
- [ ] Workers & Pages → Settings → Variables: delete `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and `AUTH_MODE`.
- [ ] Optional: delete unclaimed legacy data after 90 days (I will give the exact SQL then).

## Rolling back

- **A claim:** `npm run admin -- unclaim <username>` puts that account's data back under its Access e-mail (and the account can claim again).
- **Step D:** remove the Bypass policy (Access is back in front), then `AUTH_MODE` = `both`. Accounts, sessions and claimed data stay valid.
- **Everything:** unclaim every claimed account first, then `AUTH_MODE` = `access`: the old Access-only behaviour, the new tables ignored. (Switching to `access` without unclaiming hides claimed data, because it is now under account ids.)
- **Worst case:** restore `backup-before-accounts.sql` (or a weekly backup, or D1 Time Travel, docs/SYNC.md).

## If you are locked out

- Lost your password: use the recovery code (Settings → Account → Log in → *Forgot password?*).
- Lost the recovery code too: another admin makes a reset code (Settings → Account → Admin → *Reset password*), or `npm run admin -- reset <username>` prints one (needs `npx wrangler login`). Enter it under *Forgot password?*.
- No admin can log in at all: `npm run admin -- list` to see the accounts, then `npm run admin -- reset <username>` for yours. With no accounts at all and no `SETUP_CODE`: `npm run admin -- bootstrap <username>`, then *Forgot password?* with the code it prints.
- Before step E, Access can stand in: put the Access policy back (remove Bypass) and set `AUTH_MODE` = `both`; the old sign-in reaches your claimed data through your account.
