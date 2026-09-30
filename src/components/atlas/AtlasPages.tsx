import { useMemo, useState } from 'react';
import { Coins, Package, RotateCcw, Search, Swords, Users } from 'lucide-react';
import { completion, itemSources, searchTrainers } from '@/domain/atlas';
import { toID } from '@/data/dex';
import { useAtlasStore, useProgress } from '@/store/atlasStore';
import { ItemSprite } from '../ui/ItemSprite';
import { Sprite } from '../ui/Sprite';
import { Button, EmptyState, Input, Panel } from '../ui/primitives';
import { cn } from '../ui/styles';
import { useAtlasCtx } from './context';
import { KIND_LABEL } from './TrainerDetail';

/** Item database: every item of the game, its price and effect, TM/HM move and every place to get it. */
export function ItemsPage({ focus }: { focus?: string }) {
  const { file, dex, locName, openLocation, speciesName } = useAtlasCtx();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | undefined>(focus);
  const [shown, setShown] = useState(focus ?? open);
  if (focus && focus !== shown) {
    setShown(focus);
    setOpen(focus);
  }
  const sources = useMemo(() => itemSources(file), [file]);
  const all = useMemo(() => Object.entries(file.items).sort(([, a], [, b]) => a.name.localeCompare(b.name)), [file]);
  const t = toID(q);
  const list = all.filter(([id, i]) => !t || toID(i.name).includes(t) || toID(i.pocket).includes(t) || (i.move && toID(dex.move(i.move)?.name ?? i.move).includes(t)) || (!!id && id === t));
  void speciesName;
  return (
    <Panel title={`Items (${list.length})`} actions={<label className="relative"><Search size={14} className="pointer-events-none absolute top-2.5 left-2 text-muted" aria-hidden /><Input className="pl-7" placeholder="Name, pocket, TM move…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" /></label>}>
      {!list.length && <EmptyState icon={Package} title="No items match" />}
      <ul className="divide-y divide-border/60">
        {list.map(([id, it]) => {
          const src = sources.get(id) ?? [];
          const isOpen = open === id;
          return (
            <li key={id} id={`atlas-item-${id}`} className={cn('py-1.5', isOpen && 'bg-accent/5')}>
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? undefined : id)} className="flex w-full items-center gap-2 text-left">
                <ItemSprite itemId={id} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{it.name}{it.move ? ` · ${dex.move(it.move)?.name ?? it.move}` : ''}</span>
                  <span className="block truncate text-xs text-muted">{it.description || it.pocket}</span>
                </span>
                <span className="font-mono text-xs text-muted">{src.length} place{src.length === 1 ? '' : 's'}</span>
                <span className="inline-flex w-16 items-center justify-end gap-0.5 font-mono text-xs tabular-nums">{it.price ? <><Coins size={11} aria-hidden /> {it.price.toLocaleString()}</> : '—'}</span>
              </button>
              {isOpen && (
                <div className="mt-1.5 space-y-1 pl-9 text-sm">
                  <p className="whitespace-pre-line text-muted">{it.description}</p>
                  {src.length ? (
                    <ul className="space-y-0.5">
                      {src.map((s, i) => (
                        <li key={i}>
                          <button type="button" className="font-semibold text-accent hover:underline" onClick={() => openLocation(s.loc)}>{locName(s.loc)}</button>
                          <span className="text-xs text-muted"> · {s.how === 'mart' ? `sold at ${s.where}${s.price ? ` for ${s.price.toLocaleString()}` : ''}` : s.where}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted">No placement found in the map data (dropped by a wild or trainer Pokémon, bred, or gained another way).</p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** Trainer index: name / class / location, Pokémon used, move used. */
export function TrainersPage() {
  const { file, dex, format, locName, speciesName, openTrainer } = useAtlasCtx();
  const [text, setText] = useState('');
  const [mon, setMon] = useState('');
  const [move, setMove] = useState('');
  const [limit, setLimit] = useState(60);
  const moveName = (id: string) => dex.move(id)?.name ?? id;
  const usedMoves = useMemo(() => [...new Set(Object.values(file.trainers).flatMap((t) => t.party.flatMap((m) => m.moves)))], [file]);
  const results = useMemo(() => {
    const speciesIn = mon ? new Set(Object.values(file.trainers).flatMap((t) => t.party.map((m) => m.species)).filter((s) => toID(speciesName(s)).includes(toID(mon)))) : undefined;
    const moveIn = move ? new Set(usedMoves.filter((m) => toID(moveName(m)).includes(toID(move)))) : undefined;
    const seen = new Set<string>();
    return searchTrainers(file, { text, speciesIn, moveIn }, { species: speciesName, loc: locName })
      .sort((a, b) => Number(!!b.loc) - Number(!!a.loc) || a.name.localeCompare(b.name))
      .filter((t) => !seen.has(t.group) && seen.add(t.group));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, text, mon, move, usedMoves]);
  return (
    <Panel title={`Trainers (${results.length})`}>
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <Input placeholder="Name, class or location" value={text} onChange={(e) => { setText(e.target.value); setLimit(60); }} aria-label="Search trainers by name, class or location" />
        <Input placeholder="Pokémon used" value={mon} onChange={(e) => { setMon(e.target.value); setLimit(60); }} aria-label="Pokémon the trainer uses" />
        <Input placeholder="Move used" value={move} onChange={(e) => { setMove(e.target.value); setLimit(60); }} aria-label="Move the trainer uses" />
      </div>
      {!results.length && <EmptyState icon={Swords} title="No trainer matches" />}
      <ul className="divide-y divide-border/60">
        {results.slice(0, limit).map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => openTrainer(t.group)} className="flex w-full items-center gap-2 py-1.5 text-left hover:bg-surface-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{t.name} <span className="font-normal text-muted">{t.cls}</span></span>
                <span className="block truncate text-xs text-muted">{KIND_LABEL[t.kind]} · {t.loc ? locName(t.loc) : 'location not in the game’s map data'}</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-semibold text-accent"><Users size={12} aria-hidden /> Team</span>
              <span className="flex shrink-0">{t.party.map((m, i) => <Sprite key={i} speciesId={m.species} name={speciesName(m.species)} types={dex.species(m.species)?.types} set={format.spriteSet} size={28} className="-ml-2 first:ml-0" />)}</span>
            </button>
          </li>
        ))}
      </ul>
      {results.length > limit && <Button className="mt-2" onClick={() => setLimit(limit + 120)}>Show more ({results.length - limit} left)</Button>}
    </Panel>
  );
}

/** Progress tracker: locations visited, items collected, trainers beaten; saved on this device. */
export function ProgressPage() {
  const { file, game } = useAtlasCtx();
  const progress = useProgress(game.id);
  const reset = useAtlasStore((s) => s.resetProgress);
  const c = completion(file, progress);
  const rows = [
    { label: 'Locations visited', v: c.locations },
    { label: 'Items collected', v: c.items },
    { label: 'Trainers beaten', v: c.trainers },
  ];
  return (
    <Panel title={`${game.name} progress`} actions={<Button size="sm" variant="danger" onClick={() => window.confirm('Clear all progress for this game?') && reset(game.id)}><RotateCcw size={13} aria-hidden /> Reset</Button>}>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex justify-between text-sm"><span>{r.label}</span><span className="font-mono tabular-nums">{r.v.done} / {r.v.total} · {r.v.pct}%</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={r.label} aria-valuenow={r.v.pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-accent" style={{ width: `${r.v.pct}%` }} />
            </div>
          </div>
        ))}
        <p className="text-xs text-muted">Tick items and trainers in a location’s tabs; “Mark visited” sits at the top of the panel. Saved in this browser with your other data.</p>
      </div>
    </Panel>
  );
}
