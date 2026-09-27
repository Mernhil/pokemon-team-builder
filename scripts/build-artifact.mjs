/**
 * Builds the portable single-file app and strips the document skeleton so the page can be
 * published as a claude.ai Artifact (the host adds its own <html>/<head>/<body>).
 * Output: dist/artifact.html + dist/sprites/* (publish both).
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

execSync('npx vite build --mode singlefile', { stdio: 'inherit' });
const html = readFileSync('dist/index.html', 'utf8');
const head = html.match(/<head>([\s\S]*)<\/head>/)[1];
const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
const title = head.match(/<title>[\s\S]*?<\/title>/)[0];
const rest = head
  .replace(title, '')
  .replace(/<meta[^>]*>\s*/g, '')
  .replace(/<link rel="icon"[^>]*>\s*/g, '')
  .trim();
writeFileSync('dist/artifact.html', `${title}\n${rest}\n${body.trim()}\n`);
console.log('wrote dist/artifact.html');
