# Pokémon Team Builder

- Stack: Vite + React 19 + TS strict + Tailwind v4 + Zustand. Domain logic lives in `src/domain/`, which has no React imports.
- Data: `npm run data` rebuilds `src/data/generated/*` (Champions, `gen1…gen9`, and `lgpe`/`bdsp`/`pla`/`za` from Showdown's game mods) from `@pkmn/dex` / `@pkmn/mods`, a pinned Showdown checkout (`scripts/sources.ts`) and `src/data/regulations/*.json`. Never hand-edit the generated files.
- Pokédex: `npm run pokedex` rebuilds `pokedex-<book>.json` from PokeAPI CSVs + PKHeX encounter tables (pinned in `scripts/sources.ts`; run after `npm run data`); `npm run maps` rebuilds `public/maps/*.png` + `maps.json` from the pret disassemblies and the hand-placed schematics in `src/data/maps/*.json` (those you may edit). Keep `gens.test.ts`' map-coverage test green.
- Sprites: `npm run sprites` rebuilds `public/sprites/*` atlases from PokeAPI.
- Regulation updates follow `docs/UPDATING_REGULATIONS.md` exactly.
- Phone app: PWA (`vite-plugin-pwa` + `src/pwa.ts`), hosted on Cloudflare Workers (`wrangler.jsonc`, auto-deploys on push) behind Cloudflare Access; see `docs/IPHONE_APP.md`.
- Before any commit: `npm run typecheck && npm test`.
- Hosted app: claude.ai artifact https://claude.ai/artifact/HepTcJzeCYHWDyP4qGmNia
  - Republish `dist/artifact.html` from `npm run build:artifact`.
  - Pass `files` = every file in `dist/sprites/`, `dist/maps/` and `dist/data/`, published at `sprites/<name>`, `maps/<name>` and `data/<name>` (the single-file build fetches the Gen 1–9 data from `data/`).
