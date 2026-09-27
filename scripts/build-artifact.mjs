/**
 * Builds the portable single-file app and strips the document skeleton so the page can be
 * published as a claude.ai Artifact (the host adds its own <html>/<head>/<body>).
 * Output: dist/artifact.html + dist/sprites/*, dist/maps/* and dist/data/* (publish all of them).
 * The Gen 1–9 datasets, Pokédex files and map layouts are too big to inline, so the single-file
 * build fetches them from data/ (src/data/generated-loader.ts); they're copied there below.
 */
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

execSync('npx vite build --mode singlefile', { stdio: 'inherit' });
const html = readFileSync('dist/index.html', 'utf8');
const head = html.match(/<head>([\s\S]*)<\/head>/)[1];
const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
const title = head.match(/<title>[\s\S]*?<\/title>/)[0];
const rest = head
  .replace(title, '')
  .replace(/<meta[^>]*>\s*/g, '')
  .replace(/<link rel="(icon|apple-touch-icon)"[^>]*>\s*/g, '')
  .trim();
writeFileSync('dist/artifact.html', `${title}\n${rest}\n${body.trim()}\n`);
mkdirSync('dist/data', { recursive: true });
const side = readdirSync('src/data/generated').filter((f) => /^(gen\d|pokedex-gen\d|maps)[\w-]*\.json$/.test(f));
for (const f of side) copyFileSync(`src/data/generated/${f}`, `dist/data/${f}`);
console.log(`wrote dist/artifact.html (+ ${side.length} files in dist/data/)`);
