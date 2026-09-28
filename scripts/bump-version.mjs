/**
 * Sets the app version everywhere it lives, in one go: `npm run bump -- 0.6.0`.
 *   src-tauri/tauri.conf.json  — what the desktop updater compares and latest.json advertises
 *   src-tauri/Cargo.toml / Cargo.lock
 *   package.json / package-lock.json
 * The release workflow refuses a tag that doesn't match these (see docs/DESKTOP_RELEASES.md).
 * Edits are textual so each file keeps its formatting.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2]?.replace(/^v/, '');
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: npm run bump -- <major.minor.patch>   (e.g. npm run bump -- 0.6.0)');
  process.exit(1);
}

function edit(path, pattern, replacement) {
  const src = readFileSync(path, 'utf8');
  if (!pattern.test(src)) throw new Error(`${path}: version field not found`);
  writeFileSync(path, src.replace(pattern, replacement));
}

edit('src-tauri/tauri.conf.json', /("version":\s*")[^"]+(")/, `$1${version}$2`);
edit('src-tauri/Cargo.toml', /(\[package\][^[]*?\nversion\s*=\s*")[^"]+(")/, `$1${version}$2`);
edit('src-tauri/Cargo.lock', /(\[\[package\]\]\nname = "pokemon-team-builder"\nversion = ")[^"]+(")/, `$1${version}$2`);
edit('package.json', /("version":\s*")[^"]+(")/, `$1${version}$2`);
// package-lock.json: the top-level version and the root package entry (packages[""]).
edit('package-lock.json', /^(\{\n\s*"name": "pokemon-team-builder",\n\s*"version": ")[^"]+(")/, `$1${version}$2`);
edit('package-lock.json', /("packages": \{\n\s*"": \{\n\s*"name": "pokemon-team-builder",\n\s*"version": ")[^"]+(")/, `$1${version}$2`);

console.log(`Version set to ${version}. Commit it, then publish a GitHub release tagged v${version}.`);
