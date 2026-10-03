import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import type { WildRow } from '@/domain/atlas';
import { ENCOUNTER_LABEL, areaStatus, encounterCheck, logEncounter, removeEncounter, type EncounterStatus, type Run, type RunEncounter } from '@/domain/runs';
import { useRunStore } from '@/store/runStore';
import { toast } from '@/store/toastStore';
import { Sprite } from '../ui/Sprite';
import { Button, Chip, Input, Panel, Select } from '../ui/primitives';
import { cn } from '../ui/styles';
import { useAtlasCtx } from '../atlas/context';

const STATUS_TEXT = { used: 'Encounter used', available: 'Encounter available', none: 'No wild encounters' } as const;
const STATUS_TONE = { used: 'warn', available: 'good', none: 'neutral' } as const;

/** One row per species of a place (levels merged across methods). */
function speciesRows(rows: WildRow[]) {
  const by = new Map<string, { species: string; min: number; max: number; methods: Set<string> }>();
  for (const r of rows) {
    const cur = by.get(r.species);
    if (cur) {
      cur.min = Math.min(cur.min, r.min);
      cur.max = Math.max(cur.max, r.max);
      cur.methods.add(r.method);
    } else by.set(r.species, { species: r.species, min: r.min, max: r.max, methods: new Set([r.method]) });
  }
  return [...by.values()].sort((a, b) => a.species.localeCompare(b.species));
}

/** Encounters: every place with its wild Pokémon, the run's rules applied, and one-tap logging. */
export function RunEncounters({ run, wild, loading }: { run: Run; wild: Map<string, WildRow[]>; loading: boolean }) {
  const { file, dex, locName } = useAtlasCtx();
  const [filter, setFilter] = useState('');
  const [openLoc, setOpenLoc] = useState<string>();
  const update = useRunStore.getState().update;

  const places = useMemo(() => {
    const ids = new Set([...Object.keys(file.locations), ...wild.keys()]);
    const t = filter.trim().toLowerCase();
    return [...ids]
      .filter((id) => !t || locName(id).toLowerCase().includes(t) || (wild.get(id) ?? []).some((r) => (dex.species(r.species)?.name ?? r.species).toLowerCase().includes(t)))
      .sort((a, b) => locName(a).localeCompare(locName(b), undefined, { numeric: true }));
  }, [file, wild, filter, locName, dex]);

  const log = (loc: string, status: EncounterStatus, species: string | undefined, level: number | undefined, nickname?: string) => {
    let id = '';
    update(run.id, (r, now) => {
      const next = logEncounter(r, { loc, species, status, level, nickname }, now);
      id = next.encounters[next.encounters.length - 1].id;
      return next;
    });
    const name = species ? (dex.species(species)?.name ?? species) : 'nothing';
    toast(`${ENCOUNTER_LABEL[status]}: ${name} at ${locName(loc)}.`, { label: 'Undo', run: () => update(run.id, (r, now) => removeEncounter(r, id, now)) });
  };

  return (
    <div className="space-y-3">
      <Input aria-label="Find a place or a Pokémon" placeholder="Find a place or a Pokémon…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {loading && <p className="text-sm text-muted">Loading the encounter tables…</p>}
      <ul aria-label="Places" className="divide-y divide-border/60 rounded-xl border border-border">
        {places.map((id) => {
          const rows = speciesRows(wild.get(id) ?? []);
          const status = areaStatus(run, id, rows.length > 0);
          const open = openLoc === id;
          return (
            <li key={id}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenLoc(open ? undefined : id)}
                className={cn('flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2', open && 'bg-surface-2')}
              >
                {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{locName(id)}</span>
                <Chip tone={STATUS_TONE[status]}>{STATUS_TEXT[status]}</Chip>
              </button>
              {open && <PlaceEncounters run={run} loc={id} rows={rows} onLog={log} />}
            </li>
          );
        })}
        {places.length === 0 && !loading && <li className="p-4 text-sm text-muted">No place matches.</li>}
      </ul>
      <ManualEncounter run={run} places={places} onLog={log} />
      <EncounterLog run={run} />
    </div>
  );
}

function PlaceEncounters({ run, loc, rows, onLog }: { run: Run; loc: string; rows: ReturnType<typeof speciesRows>; onLog: (loc: string, status: EncounterStatus, species: string | undefined, level: number | undefined, nickname?: string) => void }) {
  const { dex, speciesName, format } = useAtlasCtx();
  const get = (id: string) => dex.species(id);
  const [nickname, setNickname] = useState('');
  const [shiny, setShiny] = useState(false);
  const here = run.encounters.filter((e) => e.loc === loc);
  return (
    <div className="space-y-2 bg-surface-2/50 px-3 pb-3">
      {run.rules.nuzlocke && run.rules.shiny && rows.length > 0 && (
        <label className="flex min-h-8 items-center gap-2 text-sm pointer-coarse:min-h-11">
          <input type="checkbox" checked={shiny} onChange={(e) => setShiny(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
          It was shiny (the shiny clause allows it even if the area is used)
        </label>
      )}
      {rows.length > 0 && <Input aria-label="Nickname for the next catch" placeholder="Nickname (optional)" value={nickname} maxLength={30} onChange={(e) => setNickname(e.target.value)} className="max-w-xs" />}
      {rows.length === 0 ? (
        <p className="pt-2 text-sm text-muted">The game has no wild encounters here.</p>
      ) : (
        <ul aria-label={`Wild Pokémon at ${loc}`} className="space-y-1.5 pt-1">
          {rows.map((r) => {
            const check = encounterCheck(run, loc, r.species, get, { shiny });
            const name = speciesName(r.species);
            const sp = dex.species(r.species);
            return (
              <li key={r.species} data-blocked={!check.ok} className={cn('flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2', !check.ok && 'opacity-60')}>
                <Sprite speciesId={r.species} name={name} types={sp?.types} set={format.spriteSet} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{name}</span>
                  <span className="block truncate text-xs text-muted">
                    Lv {r.min === r.max ? r.min : `${r.min}–${r.max}`} · {[...r.methods].join(', ')}
                  </span>
                  {!check.ok && <span className="block text-xs font-semibold text-warn">{check.problems.join(' ')}</span>}
                </span>
                <span className="flex gap-1">
                  {(['caught', 'fainted', 'fled'] as const).map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={s === 'caught' && check.ok ? 'primary' : 'default'}
                      aria-label={`${ENCOUNTER_LABEL[s]}: ${name}`}
                      onClick={() => {
                        onLog(loc, s, r.species, r.min, s === 'caught' ? nickname : undefined);
                        if (s === 'caught') setNickname('');
                        setShiny(false);
                      }}
                    >
                      {ENCOUNTER_LABEL[s]}
                    </Button>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Button size="sm" onClick={() => onLog(loc, 'skipped', undefined, undefined)}>
        Skipped: nothing usable here
      </Button>
      {here.length > 0 && (
        <ul aria-label="Logged here" className="space-y-0.5 text-sm">
          {here.map((e) => (
            <EncounterLine key={e.id} run={run} e={e} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EncounterLine({ run, e, showLoc }: { run: Run; e: RunEncounter; showLoc?: boolean }) {
  const { speciesName, locName } = useAtlasCtx();
  return (
    <li className="flex items-center gap-2">
      {showLoc && <span className="w-28 shrink-0 truncate text-xs text-muted">{locName(e.loc)}</span>}
      <Chip tone={e.status === 'caught' || e.status === 'gift' ? 'good' : e.status === 'fainted' ? 'bad' : 'neutral'}>{ENCOUNTER_LABEL[e.status]}</Chip>
      <span className="min-w-0 flex-1 truncate">
        {e.species ? speciesName(e.species) : 'No Pokémon'}
        {e.nickname ? ` “${e.nickname}”` : ''}
        {e.shiny ? ' ✦' : ''}
      </span>
      <Button size="icon-sm" variant="ghost" aria-label={`Remove the ${ENCOUNTER_LABEL[e.status].toLowerCase()} ${e.species ? speciesName(e.species) : 'entry'}`} onClick={() => useRunStore.getState().update(run.id, (r, now) => removeEncounter(r, e.id, now))}>
        <X size={14} aria-hidden />
      </Button>
    </li>
  );
}

/** Gifts, trades, statics and anything the tables don't list. */
function ManualEncounter({ run, places, onLog }: { run: Run; places: string[]; onLog: (loc: string, status: EncounterStatus, species: string | undefined, level: number | undefined, nickname?: string) => void }) {
  const { dex, locName } = useAtlasCtx();
  const [loc, setLoc] = useState('');
  const [species, setSpecies] = useState('');
  const [status, setStatus] = useState<EncounterStatus>('gift');
  const [nickname, setNickname] = useState('');
  const [level, setLevel] = useState('5');
  const id = useMemo(() => {
    const t = species.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    return t && dex.species(t) ? dex.species(t)!.id : undefined;
  }, [species, dex]);
  const names = useMemo(() => dex.allSpecies().map((s) => s.name), [dex]);
  const ok = !!loc && (status === 'skipped' || !!id);
  void run;
  return (
    <Panel title="Log something else" bodyClassName="p-3">
      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          onLog(loc, status, id, Number(level) || 5, nickname);
          setSpecies('');
          setNickname('');
        }}
      >
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Where
          <Select value={loc} onChange={(e) => setLoc(e.target.value)} aria-label="Where">
            <option value="">Pick a place…</option>
            {places.map((p) => (
              <option key={p} value={p}>
                {locName(p)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          What happened
          <Select value={status} onChange={(e) => setStatus(e.target.value as EncounterStatus)} aria-label="What happened">
            {(Object.keys(ENCOUNTER_LABEL) as EncounterStatus[]).map((s) => (
              <option key={s} value={s}>
                {ENCOUNTER_LABEL[s]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Pokémon
          <Input value={species} onChange={(e) => setSpecies(e.target.value)} list="run-species" aria-label="Pokémon" placeholder="e.g. Turtwig" autoComplete="off" />
          <datalist id="run-species">{names.map((n) => <option key={n} value={n} />)}</datalist>
        </label>
        <div className="grid grid-cols-[1fr_5rem] gap-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Nickname
            <Input value={nickname} maxLength={30} onChange={(e) => setNickname(e.target.value)} aria-label="Nickname" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Level
            <Input type="number" min={1} max={100} value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Level" />
          </label>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" variant="primary" disabled={!ok}>
            Log it
          </Button>
          {species && !id && status !== 'skipped' && <span className="ml-2 text-xs text-muted">Pick a Pokémon from the list.</span>}
        </div>
      </form>
    </Panel>
  );
}

/** The newest encounters across all places, for a quick check and undo. */
function EncounterLog({ run }: { run: Run }) {
  const recent = [...run.encounters].reverse().slice(0, 8);
  if (!recent.length) return null;
  return (
    <Panel title={`Recent encounters (${run.encounters.length})`} bodyClassName="p-3">
      <ul className="space-y-1 text-sm" aria-label="Recent encounters">
        {recent.map((e) => (
          <EncounterLine key={e.id} run={run} e={e} showLoc />
        ))}
      </ul>
    </Panel>
  );
}
