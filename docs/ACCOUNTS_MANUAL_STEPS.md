# Accounts rollout: what you do by hand

The code ships in small PRs (docs/ACCOUNTS_PLAN.md section 14). Every merge deploys by itself and is safe with the default `AUTH_MODE=access` (today's behaviour). The steps below are the only things the code cannot do. Do them in this order, when you are home.

Tick each box; "Check" says how to know it worked.

## A. Before the first accounts PR is useful (once)

- [ ] **Stay on the Workers Free plan; nothing to buy.** The slow password hashing runs on the device, so the Worker spends well under the Free plan's 10 ms of CPU per request.
      *Check:* after the first login, Workers & Pages → pokemon-team-builder → Metrics shows no "exceeded CPU" errors.
- [ ] **Set the Worker secrets** (Workers & Pages → pokemon-team-builder → Settings → Variables and Secrets → Add, type **Secret**):
  - `PASSWORD_PEPPER`: 32+ random characters (for example `openssl rand -base64 48`). **Save a copy in your password manager.** If it is lost, every password is unusable and each user needs an admin reset.
  - `SETUP_CODE`: any long random string. It is used once, to create the first (admin) account.
  *Check:* Settings → Sync (or `/api/health`) no longer says `PASSWORD_PEPPER not set`.
- [ ] Confirm the build's deploy command is still `npm run deploy` (migrations first) and its API token has D1: Edit (docs/SYNC.md).

## B. Turn the accounts on for yourself (still behind Access)

- [ ] Set the variable `AUTH_MODE` = `both` (plain variable, not secret; `keep_vars` keeps it across deploys).
- [ ] In the app: Settings → Account → **Create account** → enter `SETUP_CODE` in *Invite code*, a username and a password. **Save the recovery code** it shows (once only; *Copy code*, then tick *I saved it*).
- [ ] **Delete the `SETUP_CODE` secret.**
- [ ] Log in once on the phone, the website and the desktop app (the desktop app asks for *Your app address* the first time; it reaches the account routes through `/api/device/*`, which Access already lets through, so nothing changes in Access). *Check:* Settings → Account → Devices lists all three.
- [ ] Try *Sign out* on one device from another: *Check:* the signed-out device shows *Your sign-in has expired* at the top within a few minutes (or when you open Settings → Account), and *Sign in again* logs it back in.
- [ ] Settings → Account → **Admin** → *Make an invite* (note "test"), then on a second device (or a private window) *Create account* with that code as a test user. *Check:* the invite shows *Used by <name>*; Admin → Accounts lists both; *Disable* signs the test account out at once, *Enable* lets it back in; *Reset password* (asks for your own password) gives a code that works once under *Forgot password?*.
- [ ] Optional: try the command line once so you know it works when you need it: `npx wrangler login`, then `npm run admin -- list`.
- [ ] Sync is unchanged in this step: it still uses Cloudflare Access (and pairing on the desktop app). Being logged in or out doesn't affect it yet.

## C. Backup, then claim your old data

- [ ] **Back up D1** (a terminal in the repo, logged into wrangler): `npx wrangler d1 export pokemon-team-builder --remote --output backup-before-claim.sql`. Keep the file somewhere safe.
- [ ] In the GitHub repo → Settings → Secrets and variables → Actions, add `CLOUDFLARE_API_TOKEN` (Cloudflare dashboard → My Profile → API Tokens → Create → Custom: **Account → D1 → Read**) and `AGE_PUBLIC_KEY` (`age-keygen -o key.txt` prints `Public key: age1…`; that line is the secret, and **key.txt goes in your password manager**). If the token can see more than one Cloudflare account, also add `CLOUDFLARE_ACCOUNT_ID`.
      *Check:* Actions → **D1 backup** → *Run workflow*; the run ends with a `d1-backup` artifact (an `.age` file).
- [ ] In the app, **in the browser or phone app where you are signed in through Access**: Settings → Account → **Bring my teams from before** → it names your Access e-mail and how many teams, matches, shares and desktop apps → *Bring them over*. (Right after making an account it is offered at once; *Skip* is only for accounts with nothing from before.)
      *Check:* your teams, match log and shares are all there, no "Conflict copy" appeared, the phone and the website still sync, and the desktop app still syncs (it keeps its pairing until step 5).
- [ ] Friends who used the app before: each makes their account (with an invite) while Access is still in front for them, then does the same. (Without Access for them, or if one forgets: `npm run admin -- claim <their e-mail> <their username> --backup backup.sql`.)
- [ ] If something looks wrong: `npm run admin -- unclaim <username>` puts the data back under the e-mail; then `AUTH_MODE` = `access` if you want the old behaviour entirely. (Switching to `access` alone hides claimed data until it is unclaimed.)

## D. Go live (lets friends in)

- [ ] **Access → Bypass.** Cloudflare Zero Trust → Access → Applications → your app → Policies: add a policy with action **Bypass**, *Include: Everyone* (or turn the application off). Reversible in one click. Do **not** delete the application yet.
      *Check:* a private window opens `https://<your-worker>/` without an Access login, and `https://<your-worker>/api/sync` answers `401 {"error":"not signed in"}` from the Worker.
- [ ] (Optional, recommended) Security → WAF → Rate limiting rules: a rule on URI path starts with `/api/auth/`, 20 requests per 10 seconds per IP, action Block. The Worker has its own limits; this is an outer shield.
- [ ] Settings → Account → **Admin** → create an invite (note it for the friend). Send them the **code** (not a link). They install the app, tap Create account, enter the code.
- [ ] Settings → Friends: add your friends by username (or make a friend link), then share a team to test.

## E. Remove Access (only after you tell me to; the last PR)

- [ ] Wait about a week of normal use with Access on Bypass.
- [ ] Tell me "go" and I merge the final PR (removes the Access code, pairing, `/api/device/*`).
- [ ] After that deploy: Zero Trust → Access → Applications → **delete** the main application **and** the `/api/device/*` bypass application.
- [ ] Workers & Pages → Settings → Variables: delete `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and `AUTH_MODE`.
- [ ] Optional: delete unclaimed legacy data after 90 days (I will give the exact SQL then).

## If you are locked out

- Lost your password: use the recovery code (Settings → Account → "Forgot password?").
- Lost the recovery code too: another admin makes a reset code (Settings → Account → Admin → *Reset password*), or `npm run admin -- reset <username>` prints one (needs `npx wrangler login`). Enter it under *Forgot password?*.
- No admin can log in at all: `npm run admin -- list` to see the accounts, then `reset <username>` for yours. With no accounts at all and no `SETUP_CODE`: `npm run admin -- bootstrap <username>`.
- Anything else: set `AUTH_MODE` = `access` and the old Access login works again (until step E).
