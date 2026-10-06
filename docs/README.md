# Documentation index

Hand-written guides (edit these):

| File | What it covers |
|---|---|
| [UI.md](UI.md) | UI conventions: primitives, tokens, touch targets, the two looks, undo vs confirm, accessibility |
| [E2E.md](E2E.md) | The Playwright smoke and axe tests |
| [IPHONE_APP.md](IPHONE_APP.md) | The installable web app on Cloudflare Workers behind Access |
| [SYNC.md](SYNC.md) | Cloud sync and sharing: setup, how it works, backups |
| [DESKTOP_RELEASES.md](DESKTOP_RELEASES.md) | Desktop installers and the updater |
| [PRIVATE_REPO.md](PRIVATE_REPO.md) | Running with a private source repository |
| [BRANCHES.md](BRANCHES.md) | Branch and PR habits |
| [UPDATING_REGULATIONS.md](UPDATING_REGULATIONS.md) | The runbook for a new Champions regulation |
| [UPDATING_META.md](UPDATING_META.md) | How the usage data is built and updated |
| [atlas-sources.md](atlas-sources.md) | Where the Atlas data comes from |
| [POLISH_PLAN.md](POLISH_PLAN.md) | The polish-phase audit and plan |
| [spikes/](spikes/) | Written-up experiments |

Generated (never edit by hand; rebuilt by the command in the file's header):

| File | Command |
|---|---|
| [data-audit.md](data-audit.md) | `npm run data:audit` |
| [MAP_COVERAGE.md](MAP_COVERAGE.md) | `npm run maps` |
| [data-gaps/](data-gaps/) | `npm run atlas` |
