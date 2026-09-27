/**
 * Prints the regulation calendar as the app sees it. Used by the weekly updater to decide
 * whether anything needs doing:  npm run reg:status
 */
import manifestJson from '../src/data/generated/regulations.json' with { type: 'json' };

const manifest = manifestJson as unknown as Omit<typeof manifestJson, 'upcoming'> & {
  upcoming: { id: string; start: string; end?: string }[];
};

const now = new Date();
const day = (iso?: string) => (iso ? iso.slice(0, 10) : '—');
const regs = [...manifest.regulations].sort((a, b) => a.start.localeCompare(b.start));
const live = regs.filter((r) => new Date(r.start) <= now).at(-1);

console.log(`today            ${now.toISOString().slice(0, 10)}`);
for (const r of regs) {
  const state = r === live ? 'LIVE' : new Date(r.start) > now ? 'upcoming' : 'past';
  console.log(`${r.id.padEnd(17)}${day(r.start)} → ${day(r.end)}  ${state.padEnd(9)}${r.speciesCount} species, ${r.megaCount} megas, ${r.itemCount} items`);
}
for (const u of manifest.upcoming ?? []) console.log(`${String(u.id).padEnd(17)}${day(u.start)} → ${day(u.end)}  announced (no data yet)`);
if (live?.end) {
  const days = Math.ceil((new Date(live.end).getTime() - now.getTime()) / 86_400_000);
  console.log(`\n${live.shortName} ends in ${days} day(s).${days <= 21 ? ' Look for the next regulation announcement.' : ''}`);
}
console.log(`last checked     ${manifest.lastChecked ?? 'never'}`);
