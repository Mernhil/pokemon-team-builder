/**
 * Upstream repositories the build scripts read from, pinned to a commit so rebuilds are reproducible.
 * Each is a blob-less shallow clone under .cache/; only the paths a script asks for are checked out.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const REPOS = {
  /** Pokémon Showdown: game mods Let's Go / BDSP / Legends that @pkmn/mods doesn't ship. */
  showdown: { url: 'https://github.com/smogon/pokemon-showdown', dir: '.cache/showdown', commit: 'a5df8274e85b0889bf2a9b3422a08b39732374fc' },
  /** PKHeX: every game's wild-encounter tables, location and item names. */
  pkhex: { url: 'https://github.com/kwsch/PKHeX', dir: '.cache/pkhex', commit: '09e7f18fbb33635e35cf9ffcbfd3322403780f8e' },
} as const;

/** Make sure `paths` of `repo` are on disk; returns the repo directory. */
export function ensure(repo: keyof typeof REPOS, paths: string[]): string {
  const { url, dir, commit } = REPOS[repo];
  const abs = resolve(ROOT, dir);
  if (!existsSync(resolve(abs, '.git'))) {
    mkdirSync(dirname(abs), { recursive: true });
    execSync(`git clone -q --depth 1 --filter=blob:none --no-checkout ${url} ${abs}`, { stdio: 'inherit' });
  }
  const ref = commit || 'HEAD';
  if (commit) {
    try {
      execSync(`git cat-file -e ${commit}`, { cwd: abs, stdio: 'ignore' });
    } catch {
      execSync(`git fetch -q --depth 1 --filter=blob:none origin ${commit}`, { cwd: abs, stdio: 'inherit' });
    }
  }
  const missing = paths.filter((p) => !existsSync(resolve(abs, p)));
  if (missing.length) execSync(`git checkout ${ref} -- ${missing.map((p) => `'${p}'`).join(' ')}`, { cwd: abs, stdio: 'inherit' });
  return abs;
}
