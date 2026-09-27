# Pokémon Team Builder

- Stack: Vite + React 19 + TS strict + Tailwind v4 + Zustand. Domain logic lives in `src/domain/`, which has no React imports.
- Data: `npm run data` rebuilds `src/data/generated/*` from `@pkmn/dex` / `@pkmn/mods` plus `src/data/regulations/*.json`. Never hand-edit the generated files.
- Sprites: `npm run sprites` rebuilds `public/sprites/*` atlases from PokeAPI.
- Regulation updates follow `docs/UPDATING_REGULATIONS.md` exactly.
- Phone app: PWA (`vite-plugin-pwa` + `src/pwa.ts`), hosted on Cloudflare Workers (`wrangler.jsonc`, auto-deploys on push) behind Cloudflare Access; see `docs/IPHONE_APP.md`.
- Before any commit: `npm run typecheck && npm test`.
- Hosted app: claude.ai artifact https://claude.ai/artifact/HepTcJzeCYHWDyP4qGmNia
  - Republish `dist/artifact.html` from `npm run build:artifact`.
  - Pass `files` = every file in `dist/sprites/`, published at `sprites/<name>`.
