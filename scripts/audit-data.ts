/**
 * `npm run data:audit` — compares our generated Champions data (src/data/generated/champions.json)
 * with Showdown's CURRENT Champions mods on its master branch (not the commit pinned in
 * scripts/sources.ts, so it shows what upstream fixed since the @pkmn/mods release we build from).
 *
 *   npm run data:audit              write docs/data-audit.md, print a summary
 *   npm run data:audit -- --strict  also exit 1 when there are differences nobody has explained
 *
 * Known, intentional differences go in scripts/audit-allowlist.json, one entry (or `prefix:*`
 * family) each, with the reason. The comparison itself is src/domain/dataAudit.ts.
 *
 * Upstream's mods: `champions` is the newest regulation, `championsreg<x>` an older one on top of
 * it (Scripts.inherit). A regulation with no upstream mod (Reg M-A today) can't be compared and is
 * listed as such. Learnsets are compared against the newest regulation only: our dataset keeps one
 * list per species, built from the @pkmn/mods `champions` mod.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Dex } from '@pkmn/dex';
import {
  AllowlistSchema,
  DIFF_AREAS,
  applyAllowlist,
  diffLearnset,
  diffMegaStone,
  diffSpecies,
  legalityDiffs,
  type Difference,
} from '../src/domain/dataAudit.ts';
import { learnsetFor, type AnyDex } from './lib/champions-learnsets.ts';
import { loadShowdownMod } from './lib/showdown-mods.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKOUT = resolve(ROOT, '.cache/showdown-master');
const STRICT = process.argv.includes('--strict');
/** Showdown's repository and branch; INGAME-style override for tests and forks. */
const UPSTREAM = process.env.AUDIT_UPSTREAM_URL || 'https://github.com/smogon/pokemon-showdown';
const REPORT_LIMIT = 150;

// ---- ours ----------------------------------------------------------------------------------

interface OursSpecies {
  id: string;
  name: string;
  types: string[];
  abilities: Record<string, string>;
  baseStats: Record<string, number>;
  isMega: boolean;
  legalIn: string[];
}
interface Ours {
  species: Record<string, OursSpecies>;
  items: Record<string, { id: string; megaStone?: Record<string, string>; legalIn: string[] }>;
  moves: Record<string, { id: string; legalIn: string[] }>;
  learnsets: Record<string, string[]>;
  regulations: { id: string; shortName: string; start: string }[];
}
const ours = JSON.parse(readFileSync(resolve(ROOT, 'src/data/generated/champions.json'), 'utf8')) as Ours;
const regulations = [...ours.regulations].sort((a, b) => a.start.localeCompare(b.start));

// ---- upstream ------------------------------------------------------------------------------

function checkoutUpstream(): string {
  mkdirSync(dirname(CHECKOUT), { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: CHECKOUT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
  if (!existsSync(resolve(CHECKOUT, '.git'))) {
    execFileSync('git', ['clone', '--quiet', '--depth', '1', '--filter=blob:none', '--sparse', UPSTREAM, CHECKOUT], { stdio: 'inherit' });
    git('sparse-checkout', 'set', 'data/mods');
  } else {
    git('fetch', '--quiet', '--depth', '1', 'origin');
    git('checkout', '--quiet', '--force', 'FETCH_HEAD');
  }
  return git('rev-parse', 'HEAD');
}

const isLegal = (x: { exists: boolean; isNonstandard?: string | null; tier?: string }) => x.exists && !x.isNonstandard && x.tier !== 'Illegal';
const toID = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Which upstream mod describes which of our regulations: the newest is `champions`, older ones `championsreg<letters>`. */
function upstreamModFor(regId: string, newest: string, available: Set<string>): string | undefined {
  if (regId === newest) return 'champions';
  const mod = `championsreg${regId.replace(/^champions-reg-/, '')}`;
  return available.has(mod) ? mod : undefined;
}

interface AuditSummary {
  reg: string;
  mod?: string;
  species: [number, number];
  items: [number, number];
  moves: [number, number];
}

// ---- the audit -----------------------------------------------------------------------------

async function main() {
  const commit = checkoutUpstream();
  const available = new Set(readdirSync(resolve(CHECKOUT, 'data/mods')).filter((d) => d.startsWith('champions')));
  const newest = regulations[regulations.length - 1].id;
  const gen9 = Dex.forGen(9);
  const diffs: Difference[] = [];
  const notes: string[] = [];
  const summary: AuditSummary[] = [];
  const legalAnywhereUp = new Set<string>();
  const dexes = new Map<string, AnyDex>();

  for (const reg of regulations) {
    const mod = upstreamModFor(reg.id, newest, available);
    if (!mod) {
      notes.push(`${reg.shortName} (${reg.id}): no upstream mod, so not compared.`);
      summary.push({ reg: reg.shortName, species: [0, 0], items: [0, 0], moves: [0, 0] });
      continue;
    }
    const up = Dex.mod(mod as never, (await loadShowdownMod(CHECKOUT, mod)) as never) as AnyDex;
    dexes.set(reg.id, up);
    const upSpecies = up.species.all().filter(isLegal).map((s) => s.id);
    const upItems = up.items.all().filter(isLegal).map((i) => i.id);
    const upMoves = up.moves.all().filter((m) => m.exists && !m.isNonstandard).map((m) => m.id);
    upMoves.forEach((m) => legalAnywhereUp.add(m));
    const ourSpecies = Object.values(ours.species).filter((s) => s.legalIn.includes(reg.id)).map((s) => s.id);
    const ourItems = Object.values(ours.items).filter((i) => i.legalIn.includes(reg.id)).map((i) => i.id);
    const ourMoves = Object.values(ours.moves).filter((m) => m.legalIn.includes(reg.id)).map((m) => m.id);
    diffs.push(...legalityDiffs('species', reg.id, ourSpecies, upSpecies), ...legalityDiffs('items', reg.id, ourItems, upItems));
    // Our dataset only holds moves somebody learns, so upstream moves it never lists are not gaps by themselves.
    const holdsMove = new Set(Object.keys(ours.moves));
    diffs.push(...legalityDiffs('moves', reg.id, ourMoves, upMoves.filter((m) => holdsMove.has(m))));
    summary.push({ reg: reg.shortName, mod, species: [ourSpecies.length, upSpecies.length], items: [ourItems.length, upItems.length], moves: [ourMoves.length, upMoves.length] });
  }

  // Species data, Mega Stones and learnsets: against the newest regulation's mod.
  const up = dexes.get(newest);
  if (up) {
    for (const s of Object.values(ours.species).filter((x) => x.legalIn.includes(newest))) {
      const u = up.species.get(s.id);
      if (!u.exists) continue;
      diffs.push(
        ...diffSpecies(
          s.id,
          { types: s.types, abilities: s.abilities, baseStats: s.baseStats },
          { types: [...u.types], abilities: { ...u.abilities } as Record<string, string>, baseStats: { ...u.baseStats } },
        ),
      );
    }
    for (const item of Object.values(ours.items).filter((i) => i.legalIn.includes(newest))) {
      const u = up.items.get(item.id);
      if (!u.exists) continue;
      const theirs = u.megaStone ? Object.fromEntries(Object.entries(u.megaStone as Record<string, string>).map(([b, m]) => [toID(b), toID(m)])) : undefined;
      diffs.push(...diffMegaStone(item.id, item.megaStone, theirs));
    }
    for (const s of Object.values(ours.species).filter((x) => x.legalIn.includes(newest) && !x.isMega)) {
      const u = up.species.get(s.id);
      if (!u.exists) continue;
      const theirs = (await learnsetFor(up, gen9, u)).moves.filter((m) => legalAnywhereUp.has(m)).sort();
      diffs.push(...diffLearnset(s.id, ours.learnsets[s.id] ?? [], theirs));
    }
  }

  const allowlist = AllowlistSchema.parse(JSON.parse(readFileSync(resolve(ROOT, 'scripts/audit-allowlist.json'), 'utf8')));
  const result = applyAllowlist(diffs, allowlist);
  writeFileSync(resolve(ROOT, 'docs/data-audit.md'), report({ commit, summary, notes, result }));
  console.log(`Champions data audit against Showdown ${commit.slice(0, 10)}: ${result.unexplained.length} unexplained, ${result.explained.length} explained, ${result.stale.length} stale allowlist entries.`);
  for (const area of DIFF_AREAS) {
    const n = result.unexplained.filter((d) => d.area === area).length;
    if (n) console.log(`  ${area}: ${n}`);
  }
  console.log('wrote docs/data-audit.md');
  if (STRICT && result.unexplained.length) process.exit(1);
}

function report(o: { commit: string; summary: AuditSummary[]; notes: string[]; result: ReturnType<typeof applyAllowlist> }): string {
  const lines: string[] = [
    '# Champions data audit',
    '',
    `Generated by \`npm run data:audit\` (scripts/audit-data.ts), comparing \`src/data/generated/champions.json\` with Showdown's Champions mods on its master branch, commit \`${o.commit.slice(0, 10)}\` (\`${o.commit}\`). Do not edit by hand. Known differences are explained in \`scripts/audit-allowlist.json\`.`,
    '',
    '## Legal counts (here / upstream)',
    '',
    '| Regulation | Upstream mod | Species | Items | Moves held here |',
    '|---|---|---|---|---|',
    ...o.summary.map((s) => (s.mod ? `| ${s.reg} | \`${s.mod}\` | ${s.species.join(' / ')} | ${s.items.join(' / ')} | ${s.moves.join(' / ')} |` : `| ${s.reg} | none | not compared | not compared | not compared |`)),
    '',
    ...o.notes.map((n) => `- ${n}`),
    '',
    `**${o.result.unexplained.length}** unexplained differences, **${o.result.explained.length}** explained by the allowlist${o.result.stale.length ? `, **${o.result.stale.length}** allowlist entries that match nothing (delete them)` : ''}.`,
    '',
  ];
  const section = (title: string, rows: { id: string; detail: string; reason?: string }[]) => {
    if (!rows.length) return;
    lines.push(`## ${title}`, '');
    for (const r of rows.slice(0, REPORT_LIMIT)) lines.push(`- \`${r.id}\`: ${r.detail}${r.reason ? ` — _${r.reason}_` : ''}`);
    if (rows.length > REPORT_LIMIT) lines.push(`- … and ${rows.length - REPORT_LIMIT} more (run the audit locally for the full list).`);
    lines.push('');
  };
  for (const area of DIFF_AREAS) section(`Unexplained: ${area}`, o.result.unexplained.filter((d) => d.area === area));
  for (const area of DIFF_AREAS) section(`Explained: ${area}`, o.result.explained.filter((d) => d.area === area));
  section('Stale allowlist entries', o.result.stale.map((id) => ({ id, detail: 'matches no difference now' })));
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

await main();
