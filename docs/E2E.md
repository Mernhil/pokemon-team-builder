# End-to-end smoke tests

Playwright tests in `e2e/` run against the **production build** served by `vite preview` (not the dev
server), once on desktop Chromium (1280×800) and once on an iPhone 14 WebKit device. Every test starts
with empty localStorage and with the service worker blocked. They cover the builder (species, item,
ability, nature, moves, the SP cap), save + reload, Showdown export/import, Team check, Damage Calc
(including Base/Mega/Both), Meta, the match log, the Pokédex Area tab, Pokénav, the theme toggle, and
axe-core (WCAG 2.0/2.1 A + AA) on every main view in light and dark (in the default Sticker look and palette; other looks and palettes are covered by unit tests only), and a check that no main screen scrolls the page sideways.

## Run

```bash
npx playwright install chromium webkit   # once (CI does this itself)
npm run e2e                              # build, then all tests, both projects
npm run e2e:ui                           # same, in Playwright's interactive UI
npx playwright test --project=desktop e2e/builder.spec.ts -g "reload"   # one test, no rebuild
```

`npm run e2e` rebuilds first; `npx playwright test` alone reuses the existing `dist/` (rebuild it with
`npm run build` after changing the app). `npx playwright test` starts `vite preview` on port 4173 itself.

Where WebKit can't be installed (some sandboxes), `E2E_IPHONE_BROWSER=chromium npx playwright test`
runs the iPhone project on Chromium with the same screen size, touch and user agent. That catches
layout differences but not WebKit-only bugs; CI always uses real WebKit.

## Debug

- A failing run keeps a trace: `npx playwright show-trace test-results/<test>/trace.zip`.
- `npx playwright test --headed --debug <file>` steps through a test; `npx playwright codegen http://localhost:4173` records selectors.
- In CI the HTML report is uploaded as the `playwright-report` artifact when something fails.

## Writing tests

Use roles and labels (`getByRole`, `getByLabel`); add an `aria-label` to the app when something has no
accessible name, rather than reaching for a CSS selector. Phones differ from desktop in places: pickers
are buttons that open a search sheet, the Stat Point calculator is collapsed, and the Pokénav location
panel is a sheet. `e2e/helpers.ts` (`pickOption`, `expectPicked`, `openStatCalculator`, `importTeam`,
`setTheme`) hides those differences, so use it.

The axe check disables one rule: `meta-viewport`, because `index.html` turns pinch zoom off on purpose.
