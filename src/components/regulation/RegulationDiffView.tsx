import { useMemo, useState, type ReactNode } from 'react';
import { ArrowLeftRight, GitCompare } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { useRegulationChanges } from '@/data/regulationChanges';
import { useDex } from '@/data/useDex';
import { REGULATION_MANIFEST, currentRegulation } from '@/domain/formats';
import { regulationDiff, type Delta, type Ref } from '@/domain/regulationImpact';
import { ItemSprite } from '../ui/ItemSprite';
import { Sprite } from '../ui/Sprite';
import { Button, Chip, EmptyState, LoadingState, Notice, Panel, Select } from '../ui/primitives';

const champRegs = REGULATION_MANIFEST.regulations.filter((r) => r.game === 'champions').sort((a, b) => b.start.localeCompare(a.start));

/** Regulation diff: pick two regulations and see exactly what changed between them. */
export function RegulationDiffView() {
  const dexState = useDex('champions');
  const changes = useRegulationChanges();
  const live = currentRegulation()?.id ?? champRegs[0]?.id;
  const liveIdx = Math.max(0, champRegs.findIndex((r) => r.id === live));
  const [to, setTo] = useState(champRegs[liveIdx]?.id ?? '');
  const [from, setFrom] = useState(champRegs[liveIdx + 1]?.id ?? champRegs[liveIdx]?.id ?? '');

  const diff = useMemo(() => (dexState.status === 'ready' && from && to ? regulationDiff(dexState.dex, from, to, changes) : undefined), [dexState, from, to, changes]);

  if (champRegs.length < 2) return <EmptyState icon={GitCompare} title="Only one regulation so far">There is nothing to compare yet.</EmptyState>;
  if (dexState.status === 'loading') return <LoadingState label="Loading regulation data…" />;
  if (dexState.status === 'error') return <p className="p-10 text-center text-sm text-bad" role="alert">{dexState.error}</p>;
  const dex = dexState.dex;
  const name = (id: string) => champRegs.find((r) => r.id === id)?.shortName ?? id;
  const total = diff ? [diff.species, diff.megas, diff.items, diff.moves, diff.abilities].reduce((a, d) => a + d.added.length + d.removed.length, 0) + diff.patches.length : 0;

  return (
    <div className="space-y-3">
      <Panel bodyClassName="flex flex-wrap items-end gap-3 p-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          From
          <Select aria-label="From regulation" value={from} onChange={(e) => setFrom(e.target.value)}>
            {champRegs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.shortName}
              </option>
            ))}
          </Select>
        </label>
        <Button size="icon" aria-label="Swap the two regulations" onClick={() => { setFrom(to); setTo(from); }}>
          <ArrowLeftRight size={15} aria-hidden />
        </Button>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          To
          <Select aria-label="To regulation" value={to} onChange={(e) => setTo(e.target.value)}>
            {champRegs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.shortName}
              </option>
            ))}
          </Select>
        </label>
        {diff && <p role="status" className="ml-auto text-sm text-muted">{from === to ? 'Pick two different regulations.' : `${name(from)} → ${name(to)}: ${total} ${total === 1 ? 'change' : 'changes'}`}</p>}
      </Panel>

      {diff && from !== to && (
        <>
          <Section title="Pokémon" delta={diff.species} render={(r) => <Mon dex={dex} r={r} />} />
          <Section title="Mega Evolutions" delta={diff.megas} render={(r) => <Mon dex={dex} r={r} />} />
          <Section title="Items" delta={diff.items} render={(r) => <span className="flex items-center gap-1.5"><ItemSprite itemId={r.id} name={r.name} size={24} />{r.name}</span>} />
          <Section title="Moves" delta={diff.moves} render={(r) => <span>{r.name}</span>} />
          <Section title="Abilities" delta={diff.abilities} render={(r) => <span>{r.name}</span>} />

          <Panel title="Changes to a Pokémon (before → after)">
            {diff.patches.length === 0 ? (
              <p className="text-sm text-muted">No Pokémon changes typing, stats or abilities between these two.</p>
            ) : (
              <div className="scrollbar-thin overflow-x-auto" tabIndex={0} role="region" aria-label="Species changes, scrolls sideways on a small screen">
                <table className="w-full text-sm">
                  <caption className="sr-only">Species changes between {name(from)} and {name(to)}</caption>
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th scope="col" className="py-1 font-semibold">Pokémon</th>
                      <th scope="col" className="py-1 font-semibold">What</th>
                      <th scope="col" className="py-1 font-semibold">Before</th>
                      <th scope="col" className="py-1 font-semibold">After</th>
                      <th scope="col" className="py-1 font-semibold">In</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.patches.map((p) => (
                      <tr key={`${p.speciesId}${p.label}${p.regulationId}`} className="border-t border-border">
                        <th scope="row" className="py-1.5 text-left font-semibold">
                          <Mon dex={dex} r={{ id: p.speciesId, name: p.name }} />
                        </th>
                        <td className="py-1.5 pr-3">{p.label}</td>
                        <td className="py-1.5 pr-3 font-mono text-xs">{p.before}</td>
                        <td className="py-1.5 pr-3 font-mono text-xs font-bold">{p.after}</td>
                        <td className="py-1.5 text-xs text-muted">{name(p.regulationId)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {diff.unconfirmed.map((u) => (
            <Notice key={u.regulationId} tone="accent" title={`Unconfirmed for ${name(u.regulationId)}`}>
              <p>Listed by a single source only, so they are not in the legal lists. {u.note}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {u.speciesIds.map((id) => (
                  <li key={id} className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-2 py-0.5">
                    <Mon dex={dex} r={{ id, name: dex.species(id)?.name ?? id }} />
                    <Chip>Unconfirmed</Chip>
                  </li>
                ))}
              </ul>
            </Notice>
          ))}
        </>
      )}
    </div>
  );
}

function Mon({ dex, r }: { dex: Dex; r: Ref }) {
  const sp = dex.species(r.id);
  return (
    <span className="inline-flex items-center gap-1.5">
      <Sprite speciesId={r.id} name={r.name} types={sp?.types} set="champions" size={28} />
      {r.name}
    </span>
  );
}

/** Added and removed side by side; each entry carries a + or − as well as its place, so it never relies on colour. */
function Section({ title, delta, render }: { title: string; delta: Delta; render: (r: Ref) => ReactNode }) {
  if (delta.added.length === 0 && delta.removed.length === 0) return null;
  const list = (label: string, sign: string, items: Ref[]) =>
    items.length > 0 && (
      <div>
        <p className="mb-1.5 text-xs font-semibold text-muted">
          {sign} {label} ({items.length})
        </p>
        <ul className="grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {items.map((r) => (
            <li key={r.id} className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-1">
              <span aria-hidden className="font-mono text-muted">{sign}</span>
              {render(r)}
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <Panel title={title}>
      <div className="space-y-3">
        {list('Added', '+', delta.added)}
        {list('Removed', '−', delta.removed)}
      </div>
    </Panel>
  );
}
