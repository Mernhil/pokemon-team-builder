import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Filter, Flag, Map as MapIcon, MapPin, Package, Search, ShoppingBag, Swords, Trophy, X } from 'lucide-react';
import { useAtlas } from '@/data/atlas';
import { toID } from '@/data/dex';
import { usePokedexData } from '@/data/pokedex';
import { useDex } from '@/data/useDex';
import { ATLAS_GAMES, atlasGame, atlasGameGen, matchLocations, wildAt, wildByLocation, wildLocations, type AtlasLocation, type MapFilter } from '@/domain/atlas';
import { areaStatus } from '@/domain/runs';
import { useActiveRun } from '@/store/runStore';
import { getFormat } from '@/domain/formats';
import { skinOfMap } from '@/domain/mapSkins';
import { useAtlasStore, type AtlasPage } from '@/store/atlasStore';
import { useProgress } from '@/store/atlasStore';
import { loadMaps, type MapsFile } from '../pokedex/RegionMap';
import { Modal } from '../ui/Modal';
import { ItemSprite } from '../ui/ItemSprite';
import { Sprite } from '../ui/Sprite';
import { Chip, Input, LoadingState, Notice, Tabs } from '../ui/primitives';
import { cn } from '../ui/styles';
import { useMedia } from '../ui/useMedia';
import { AtlasMap } from './AtlasMap';
import { ItemsPage, ProgressPage, TrainersPage } from './AtlasPages';
import { AtlasProvider, useAtlasCtx, type AtlasCtx } from './context';
import { GameBadge } from '../ui/GameBadge';
import { LocationPanel } from './LocationPanel';
import { TrainerDetail } from './TrainerDetail';

const PAGES: { id: AtlasPage; label: string; icon: typeof MapIcon }[] = [
  { id: 'map', label: 'Map', icon: MapIcon },
  { id: 'items', label: 'Items', icon: Package },
  { id: 'trainers', label: 'Trainers', icon: Swords },
  { id: 'progress', label: 'Progress', icon: Trophy },
  { id: 'run', label: 'Run', icon: Flag },
];

/** Pokénav pages: an encounters-only game has no items or trainers. */
const LITE_PAGES = [PAGES[0], PAGES[3], PAGES[4]];

const RunPage = lazy(() => import('../run/RunPage').then((m) => ({ default: m.RunPage })));

/** The Pokénav tab: interactive game maps with full location, item, NPC, wild and trainer data. */
export function AtlasView() {
  const gameId = useAtlasStore((s) => s.game);
  const setGame = useAtlasStore((s) => s.setGame);
  const storedPage = useAtlasStore((s) => s.page);
  const setPage = useAtlasStore((s) => s.setPage);
  const game = atlasGame(gameId);
  const page: AtlasPage = game.lite && (storedPage === 'items' || storedPage === 'trainers') ? 'map' : storedPage;
  const file = useAtlas(game.file ?? game.id);
  const format = getFormat(game.formatId);
  const dexState = useDex(format.datasetId);
  const pd = usePokedexData(game.book);
  const [trainerGroup, setTrainerGroup] = useState<string>();
  const [itemFocus, setItemFocus] = useState<string>();
  const [pinned, setPinned] = useState<string>();

  // Deep link from the Pokédex ("Show in Atlas"): the store carries the game and location to open.
  const focus = useAtlasStore((s) => s.focus);
  useEffect(() => {
    if (!focus) return;
    setPinned(focus.loc);
    setPage('map');
    useAtlasStore.getState().setFocus(undefined);
  }, [focus, setPage]);

  const dex = dexState.status === 'ready' ? dexState.dex : undefined;
  const ctx = useMemo<AtlasCtx | null>(() => {
    if (!file || !dex) return null;
    return {
      file, game, dex, format, pokedex: pd?.dex ?? null,
      locName: (id) => (id ? file.locations[id]?.name ?? id : ''),
      itemName: (id) => file.items[id]?.name ?? dex.item(id)?.name ?? id,
      speciesName: (id) => dex.species(id)?.name ?? id,
      openLocation: (id) => {
        setPage('map');
        setPinned(id);
        setTrainerGroup(undefined);
      },
      openTrainer: (g) => setTrainerGroup(g),
      openItem: (id) => {
        setItemFocus(id);
        setPage('items');
      },
    };
  }, [file, dex, game, format, pd, setPage]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex w-full flex-col gap-1.5" role="radiogroup" aria-label="Game">
          {[...new Set(ATLAS_GAMES.map(atlasGameGen))].sort((a, b) => a - b).map((gen) => (
            <div key={gen} className="flex flex-wrap items-center gap-1">
              <span className="w-10 shrink-0 text-[11px] font-semibold tracking-wide text-muted uppercase">Gen {gen}</span>
              {ATLAS_GAMES.filter((g) => atlasGameGen(g) === gen).map((g) => (
                <button
                  key={g.id}
                  type="button"
                  role="radio"
                  aria-checked={g.id === game.id}
                  onClick={() => { setGame(g.id); setPinned(undefined); }}
                  className={cn('inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition-colors', g.id === game.id ? 'border-accent bg-accent/15 text-fg' : 'border-border text-muted hover:text-fg')}
                >
                  <GameBadge color={g.color} />
                  {g.name}
                </button>
              ))}
            </div>
          ))}
        </div>
        <Tabs label="Pokénav page" size="sm" value={page} onChange={setPage} tabs={(game.lite ? LITE_PAGES : PAGES).map((p) => ({ id: p.id, label: p.label, icon: p.icon }))} className="ml-auto" />
      </div>

      {file === false || dexState.status === 'error' ? (
        <Notice tone="bad">The Pokénav for {game.name} couldn’t load.</Notice>
      ) : !ctx ? (
        <LoadingState label={`Loading the ${game.shortName} Pokénav…`} />
      ) : (
        <AtlasProvider value={ctx}>
          {page === 'map' && <MapPage pinned={pinned} setPinned={setPinned} />}
          {page === 'items' && !game.lite && <ItemsPage focus={itemFocus} />}
          {page === 'trainers' && !game.lite && <TrainersPage />}
          {page === 'progress' && <ProgressPage />}
          {page === 'run' && (
            <Suspense fallback={<LoadingState label="Loading the run tracker…" />}>
              <RunPage />
            </Suspense>
          )}
          <Modal open={!!trainerGroup} onOpenChange={(o) => !o && setTrainerGroup(undefined)} title={trainerGroup ? (Object.values(ctx.file.trainers).find((t) => t.group === trainerGroup)?.name ?? 'Trainer') : 'Trainer'} wide>
            {trainerGroup && <TrainerDetail group={trainerGroup} />}
          </Modal>
        </AtlasProvider>
      )}
    </div>
  );
}

interface FilterState {
  gym: boolean;
  shop: boolean;
  pokecenter: boolean;
  text: string;
  item: string;
  mon: string;
  move: string;
}
const NO_FILTER: FilterState = { gym: false, shop: false, pokecenter: false, text: '', item: '', mon: '', move: '' };

function MapPage({ pinned, setPinned }: { pinned?: string; setPinned: (l: string | undefined) => void }) {
  const { file, game, pokedex, locName, dex, speciesName } = useAtlasCtx();
  const [maps, setMaps] = useState<MapsFile | null>(null);
  useEffect(() => {
    let alive = true;
    loadMaps().then((m) => alive && setMaps(m), () => {});
    return () => { alive = false; };
  }, []);
  const [hovered, setHovered] = useState<string>();
  const [filter, setFilter] = useState<FilterState>(NO_FILTER);
  // Leaving a place keeps its preview for a beat so the pointer can move onto the card and scroll it.
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hover = useCallback((l: string | undefined) => {
    clearTimeout(leaveTimer.current);
    if (l) setHovered(l);
    else leaveTimer.current = setTimeout(() => setHovered(undefined), 200);
  }, []);
  const progress = useProgress(game.id);
  const wide = useMedia('(min-width: 1024px)');
  const lite = !!game.lite;
  // With a run going, places show whether their wild encounter is available, used or absent.
  const run = useActiveRun(game.id);
  const marks = useMemo(() => {
    if (!run || !pokedex) return undefined;
    const wild = wildByLocation(pokedex, game.dexGame);
    return Object.fromEntries(Object.keys(file.locations).map((id) => [id, areaStatus(run, id, (wild.get(id)?.length ?? 0) > 0)]));
  }, [run, pokedex, game.dexGame, file]);

  const matches = useMemo(() => {
    const f: MapFilter = { text: filter.text || undefined };
    if (filter.gym) f.gym = true;
    if (filter.shop) f.shop = true;
    if (filter.pokecenter) f.pokecenter = true;
    if (filter.item) {
      const t = toID(filter.item);
      f.item = Object.keys(file.items).find((id) => toID(file.items[id].name) === t) ?? Object.keys(file.items).find((id) => toID(file.items[id].name).includes(t)) ?? '__none__';
    }
    if (filter.mon && pokedex) {
      const t = toID(filter.mon);
      const ids = Object.keys(pokedex.encounters).filter((s) => toID(speciesName(s)).includes(t));
      f.wildLocs = new Set(ids.flatMap((s) => [...wildLocations(pokedex, game.dexGame, s)]));
    }
    if (filter.move) {
      const t = toID(filter.move);
      const ids = new Set(Object.values(file.trainers).flatMap((tr) => tr.party.flatMap((m) => m.moves)).filter((m) => toID(dex.move(m)?.name ?? m).includes(t)));
      const locs = new Set<string>();
      for (const l of Object.values(file.locations)) if (l.trainers.some((id) => file.trainers[id]?.party.some((m) => m.moves.some((mv) => ids.has(mv))))) locs.add(l.id);
      const base = matchLocations(file, { ...f }, (l) => l.name);
      return base ? new Set([...base].filter((l) => locs.has(l))) : locs;
    }
    return matchLocations(file, f, (l) => l.name);
  }, [file, filter, pokedex, game.dexGame, speciesName, dex]);

  // Region switcher (Kanto / Sevii, …): the map that shows the pinned place, else the one picked.
  const [pickedMap, setPickedMap] = useState<string>();
  const gameMaps = game.mapIds.map((id) => maps?.maps[id]).filter((m): m is NonNullable<typeof m> => !!m);
  const holder = pinned ? gameMaps.find((m) => m.places[pinned]) : undefined;
  // A place opened from elsewhere (Pokédex, a connection link) switches to the region that holds it.
  useEffect(() => {
    if (holder) setPickedMap(holder.id);
  }, [holder?.id, pinned]); // eslint-disable-line react-hooks/exhaustive-deps
  const map = gameMaps.find((m) => m.id === pickedMap) ?? holder ?? gameMaps[0];
  const regionCount = (m: { places: Record<string, unknown> }) => Object.keys(m.places).filter((l) => file.locations[l]).length;
  const locations = useMemo(() => new Set(Object.keys(file.locations)), [file]);
  const done = useMemo(() => new Set(progress.locations), [progress.locations]);
  const pin = useCallback((l: string) => setPinned(pinned === l ? undefined : l), [pinned, setPinned]);
  const loc = pinned ? file.locations[pinned] : undefined;
  const hoverLoc = hovered && hovered !== pinned ? file.locations[hovered] : undefined;
  const anyFilter = matches !== null;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="min-w-0 space-y-2">
        {lite && <Notice tone="accent">{game.name} has encounters only: the places and every wild, static, gift and trade Pokémon in them. Its items, trainers and shops aren’t available.</Notice>}
        <FilterBar filter={filter} setFilter={setFilter} matchCount={matches?.size} lite={lite} />
        {!map ? <div className="aspect-[216/168] w-full animate-pulse rounded-xl bg-surface-2" /> : (
          <div className="relative">
            {gameMaps.length > 1 && (
              <div className="mb-2 flex gap-1" role="tablist" aria-label="Region">
                {gameMaps.map((m) => (
                  <button key={m.id} type="button" role="tab" aria-selected={m.id === map.id} onClick={() => { setPickedMap(m.id); if (pinned && !m.places[pinned]) setPinned(undefined); }} className={cn('h-8 flex-1 rounded-md border px-2 text-xs font-semibold', m.id === map.id ? 'border-accent bg-accent/15 text-fg' : 'border-border text-muted hover:text-fg')}>
                    {m.name}
                    <span className="ml-1 font-mono font-normal text-muted">{regionCount(m)}</span>
                  </button>
                ))}
              </div>
            )}
            <AtlasMap key={map.id} map={map} skin={skinOfMap(map.id)} locations={locations} names={locName} pinned={pinned} onPin={pin} hovered={hovered} onHover={hover} matches={matches} done={done} marks={marks} />
            {hoverLoc && wide && <PreviewCard loc={hoverLoc} onEnter={() => hover(hoverLoc.id)} onLeave={() => hover(undefined)} />}
          </div>
        )}
        {anyFilter && <p className="text-xs text-muted" aria-live="polite">{matches!.size} location{matches!.size === 1 ? '' : 's'} match; they glow on the map.</p>}
        {marks && (
          <p role="group" aria-label="Run marks" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <b className="text-fg">{run!.name}:</b>
            <span><span aria-hidden className="mr-1 inline-block size-2.5 rounded-full border-2 border-[#4cc9f0] align-middle" />encounter available</span>
            <span><span aria-hidden className="mr-1 inline-block size-2.5 bg-[#ff9f1c] align-middle" />encounter used</span>
            <span><span aria-hidden className="mr-1 inline-block h-0.5 w-2.5 bg-[#b6bcc9] align-middle" />no wild encounters</span>
          </p>
        )}
        <p className="text-xs text-muted">Hover or focus a place for a preview; click, tap or press Enter to open it. Arrow keys move between places.</p>
        {lite && <LocationList matches={matches} pinned={pinned} setPinned={setPinned} />}
      </div>
      {wide ? (
        <aside className="sticky top-16 hidden max-h-[calc(100dvh-6rem)] min-h-64 rounded-xl border border-border bg-surface p-3 lg:block" aria-label="Location details">
          {loc ? <LocationPanel key={loc.id} loc={loc} onClose={() => setPinned(undefined)} /> : <p className="p-4 text-sm text-muted">{lite ? 'Pick a place on the map or in the list to see the Pokémon found there.' : 'Pick a place on the map to see its items, NPCs, wild Pokémon and trainers.'}</p>}
        </aside>
      ) : (
        <Modal open={!!loc} onOpenChange={(o) => !o && setPinned(undefined)} title={loc?.name ?? ''} description="Location details" wide>
          {loc && <div className="h-[70dvh]"><LocationPanel key={loc.id} loc={loc} /></div>}
        </Modal>
      )}
    </div>
  );
}

/** Encounters-only games: the places with encounters as a list under the map, narrowed by the same filter. */
function LocationList({ matches, pinned, setPinned }: { matches: Set<string> | null; pinned?: string; setPinned: (l: string | undefined) => void }) {
  const { file, game, pokedex, locName } = useAtlasCtx();
  const progress = useProgress(game.id);
  const rows = useMemo(
    () => Object.values(file.locations).filter((l) => !matches || matches.has(l.id)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [file, matches],
  );
  const speciesCount = useMemo(() => {
    const n = new Map<string, number>();
    if (pokedex) for (const l of rows) n.set(l.id, new Set(wildAt(pokedex, game.dexGame, l.id).map((w) => w.species)).size);
    return n;
  }, [pokedex, game.dexGame, rows]);
  const done = new Set(progress.locations);
  return (
    <ul className="divide-y divide-border/60 rounded-xl border border-border" aria-label="Places">
      {rows.map((l) => (
        <li key={l.id}>
          <button type="button" onClick={() => setPinned(pinned === l.id ? undefined : l.id)} aria-current={pinned === l.id} className={cn('flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2', pinned === l.id && 'bg-surface-2 ring-2 ring-accent ring-inset')}>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{locName(l.id)}</span>
            {done.has(l.id) && <span className="text-[11px] font-semibold text-good">Visited</span>}
            <span className="shrink-0 font-mono text-xs text-muted">{speciesCount.get(l.id) ?? 0} Pokémon</span>
          </button>
        </li>
      ))}
      {!rows.length && <li className="p-4 text-sm text-muted">No place matches.</li>}
    </ul>
  );
}

function FilterBar({ filter, setFilter, matchCount, lite }: { filter: FilterState; setFilter: (f: FilterState) => void; matchCount?: number; lite?: boolean }) {
  const set = (p: Partial<typeof filter>) => setFilter({ ...filter, ...p });
  const toggle = (k: 'gym' | 'shop' | 'pokecenter', label: string, Icon: typeof MapPin) => (
    <button key={k} type="button" aria-pressed={filter[k]} onClick={() => set({ [k]: !filter[k] })} className={cn('inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-semibold', filter[k] ? 'border-accent bg-accent/15 text-fg' : 'border-border text-muted hover:text-fg')}>
      <Icon size={13} aria-hidden /> {label}
    </button>
  );
  const active = filter.gym || filter.shop || filter.pokecenter || filter.text || filter.item || filter.mon || filter.move;
  return (
    <div className="space-y-1.5" role="search" aria-label="Map filters">
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="relative min-w-40 flex-1">
          <Search size={14} className="pointer-events-none absolute top-2.5 left-2 text-muted" aria-hidden />
          <Input className="pl-7" placeholder="Find a place…" value={filter.text} onChange={(e) => set({ text: e.target.value })} aria-label="Find a place" />
        </label>
        {!lite && toggle('gym', 'Has Gym', Swords)}
        {!lite && toggle('shop', 'Has Mart', ShoppingBag)}
        {!lite && toggle('pokecenter', 'Pokémon Center', MapPin)}
        {active && <button type="button" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold text-muted hover:text-fg" onClick={() => setFilter(NO_FILTER)}><X size={13} aria-hidden /> Clear</button>}
        <Chip icon={Filter} className="hidden sm:inline-flex">{matchCount === undefined ? 'No filter' : `${matchCount} match`}</Chip>
      </div>
      <div className={cn('grid gap-1.5', !lite && 'sm:grid-cols-3')}>
        {!lite && <Input placeholder="Has item… (e.g. Rare Candy)" value={filter.item} onChange={(e) => set({ item: e.target.value })} aria-label="Location has item" />}
        <Input placeholder="Pokémon appears here…" value={filter.mon} onChange={(e) => set({ mon: e.target.value })} aria-label="Pokémon appears in the wild here" />
        {!lite && <Input placeholder="Trainer uses move…" value={filter.move} onChange={(e) => set({ move: e.target.value })} aria-label="A trainer here uses the move" />}
      </div>
    </div>
  );
}

/** Hover preview: everything at a glance in scrollable lists (items, trainers, wild Pokémon). */
function PreviewCard({ loc, onEnter, onLeave }: { loc: AtlasLocation; onEnter: () => void; onLeave: () => void }) {
  const { file, dex, format, pokedex, game, speciesName } = useAtlasCtx();
  const wild = useMemo(() => (pokedex ? wildAt(pokedex, game.dexGame, loc.id) : []), [pokedex, game.dexGame, loc.id]);
  const species = [...new Set(wild.map((w) => w.species))];
  const trainers = useMemo(() => {
    const seen = new Set<string>();
    return loc.trainers.map((id) => file.trainers[id]).filter((t) => t && !seen.has(t.group) && seen.add(t.group));
  }, [loc, file]);
  return (
    <div onPointerEnter={onEnter} onPointerLeave={onLeave} className="absolute top-2 right-2 z-10 w-72 rounded-xl border border-border bg-surface/95 p-3 text-xs shadow-xl backdrop-blur" role="status">
      <h3 className="text-sm font-semibold">{loc.name}</h3>
      <p className="mb-1 flex flex-wrap gap-1 text-muted">
        {loc.gym && <span>Gym · {loc.gym.badge} Badge</span>}
        {loc.pokecenter && <span>Pokémon Center</span>}
        {loc.shops.length > 0 && <span>Mart</span>}
      </p>
      {loc.items.length > 0 && <PreviewList title={`Items (${loc.items.length})`}>
        {loc.items.map((it, i) => <li key={i} className="flex items-center gap-1"><ItemSprite itemId={it.item} size={16} />{file.items[it.item]?.name ?? it.item}<span className="text-muted"> · {it.how}</span></li>)}
      </PreviewList>}
      {trainers.length > 0 && <PreviewList title={`Trainers (${trainers.length})`}>
        {trainers.map((t) => <li key={t.id} className="truncate">{t.cls} {t.name !== t.cls ? t.name : ''} <span className="text-muted">Lv {Math.max(...t.party.map((m) => m.level))}</span></li>)}
      </PreviewList>}
      <PreviewList title={`Wild Pokémon (${species.length})`}>
        {species.map((s) => <li key={s} className="flex items-center gap-1"><Sprite speciesId={s} name={speciesName(s)} types={dex.species(s)?.types} set={format.spriteSet} size={20} />{speciesName(s)}</li>)}
      </PreviewList>
    </div>
  );
}

function PreviewList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-1.5">
      <h4 className="font-semibold text-muted">{title}</h4>
      <ul className="scrollbar-thin max-h-24 space-y-0.5 overflow-y-auto pr-1">{children}</ul>
    </div>
  );
}
