import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Map as MapIcon, Maximize2, Minus, Plus } from 'lucide-react';
import type { Encounter } from '@/domain/pokedex';
import { IDENTITY_VIEW, MAX_ZOOM, centerOn, clampView, placeCenter, resolveLocations, zoomAt, type MapView, type Rect } from '@/domain/regionMaps';
import { SchematicBase } from './SchematicMap';
import { Button, Notice } from '../ui/primitives';
import { cn } from '../ui/styles';

export interface RegionMapData {
  id: string;
  name: string;
  width: number;
  height: number;
  image?: string;
  /** Painted artwork: scale smoothly instead of pixelated. */
  smooth?: boolean;
  style: 'nest' | 'area' | 'schematic';
  places: Record<string, Rect[]>;
  nestIcon?: string[];
  land?: string[];
  kinds?: Record<string, string>;
  labels?: Record<string, string>;
  source: string;
}
export interface MapsFile {
  maps: Record<string, RegionMapData>;
  /** PokeAPI version id → map ids shown for that game. */
  games: Record<string, string[]>;
}

let mapsPromise: Promise<MapsFile> | undefined;
export const loadMaps = () =>
  (mapsPromise ??= import('@/data/generated/maps.json').then((m) => m.default as unknown as MapsFile));
export const asset = (path: string) => `${import.meta.env.BASE_URL ?? './'}${path}`.replace(/^\/\//, '/');

const SOURCE_LABEL: Record<string, string> = {
  'pret/pokered': 'Red / Blue town map',
  'pret/pokecrystal': 'Crystal Pokégear map',
  'pret/pokeemerald': 'Emerald Pokédex area map',
  'pret/pokefirered': 'FireRed / LeafGreen region map',
  'pret/pokeplatinum': 'Platinum Town Map',
  schematic: 'Schematic map',
};

const placeLabel = (map: RegionMapData, loc: string) => map.labels?.[loc] ?? loc.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * The Area map: the game's region map with the Pokémon's locations marked the way that game's
 * Pokédex marked them — blinking nest icons in Gen 1–2, glowing squares from Gen 3 — or, for regions
 * without a disassembled map, a clearly labelled schematic of the region. Zoom with the buttons,
 * a pinch or ctrl/⌘ + wheel, drag to pan; tap a marked place to pick it in the list below.
 */
export function RegionMaps({ game, encounters, selected, onSelect }: { game: string; encounters: Encounter[]; selected?: string; onSelect?: (loc: string) => void }) {
  const [file, setFile] = useState<MapsFile | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadMaps()
      .then((f) => alive && setFile(f))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const found = useMemo(() => new Set(encounters.map((e) => e.area.loc)), [encounters]);
  const maps = useMemo(() => (file?.games[game] ?? []).map((id) => file!.maps[id]).filter(Boolean), [file, game]);
  const resolved = useMemo(() => resolveLocations(maps, found), [maps, found]);
  // The encounter data's own names ("Route 206") over ones derived from ids ("Sinnoh Route 206").
  const names = useMemo(() => new Map(encounters.map((e) => [e.area.loc, e.area.name])), [encounters]);
  const [picked, setPicked] = useState<string>();
  // Follow a location picked in the list onto the map that shows it.
  const holder = selected ? maps.find((m) => m.places[selected]) : undefined;
  const current = holder ?? maps.find((m) => m.id === picked) ?? resolved.best;

  if (failed) return <Notice icon={MapIcon} tone="accent">The region maps couldn’t load. The locations are listed below.</Notice>;
  if (!file) return <div className="aspect-[3/2] w-full animate-pulse rounded-xl bg-surface-2" />;
  if (!current) return null;
  const offMap = resolved.offMap.map((l) => names.get(l) ?? l);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface" aria-label="Region map">
      {maps.length > 1 && (
        <div className="flex border-b border-border" role="tablist" aria-label="Map">
          {maps.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={m.id === current.id}
              onClick={() => {
                setPicked(m.id);
                if (selected && !m.places[selected]) onSelect?.('');
              }}
              className={cn('flex-1 border-b-2 px-2 py-1.5 text-xs font-semibold pointer-coarse:py-3', m.id === current.id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}
            >
              {m.name}
              <span className="ml-1 font-mono font-normal text-muted">{resolved.hits.get(m.id)?.length ?? 0}</span>
            </button>
          ))}
        </div>
      )}
      <MapViewport key={current.id} map={current} focus={selected && current.places[selected] ? selected : undefined}>
        <MapCanvas map={current} found={found} names={names} selected={selected} onSelect={onSelect} />
      </MapViewport>
      <p className="flex flex-wrap justify-between gap-x-3 px-3 py-1.5 text-xs text-muted">
        <span>
          {SOURCE_LABEL[current.source] ?? current.source}
          {current.source === 'schematic' ? ' · not the game’s map; positions approximate' : ' · the game’s own map, from the pret decompilation'}
        </span>
        {offMap.length > 0 && <span>Not on this map: {offMap.join(', ')}</span>}
      </p>
    </section>
  );
}

/** Zoom / pan frame around a map: buttons, pinch, ctrl/⌘ + wheel, drag, double-click. */
export function MapViewport({ map, focus, fixedScale, children }: { map: RegionMapData; focus?: string; /** Integer pixel scale (pixel-perfect maps): the map is exactly this many CSS px per map pixel, or the full width when that doesn't fit. */ fixedScale?: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<MapView>(IDENTITY_VIEW);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: MapView; dist: number; mid: [number, number]; start: [number, number]; moved: boolean } | null>(null);
  const size = () => {
    const r = box.current!.getBoundingClientRect();
    return { r, w: r.width, h: r.height };
  };
  const zoomBy = (factor: number, at?: [number, number]) => {
    const { w, h } = size();
    setView((v) => zoomAt(v, factor, at?.[0] ?? w / 2, at?.[1] ?? h / 2, w, h));
  };

  // Keep the picked place in view while zoomed in.
  useEffect(() => {
    if (!focus || !box.current) return;
    const [cx, cy] = placeCenter(map.places[focus]);
    const { w, h } = size();
    setView((v) => (v.scale > 1 ? centerOn(v, cx / map.width, cy / map.height, w, h) : v));
  }, [focus, map]);

  // ctrl/⌘ + wheel (and trackpad pinch, which arrives as ctrl + wheel) zooms; a plain wheel scrolls the page.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const { r } = size();
      zoomBy(Math.exp(-e.deltaY / 200), [e.clientX - r.left, e.clientY - r.top]);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const local = (e: ReactPointerEvent): [number, number] => {
    const { r } = size();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const snapshot = () => {
    const pts = [...pointers.current.values()];
    const mid: [number, number] = pts.length > 1 ? [(pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2] : [pts[0].x, pts[0].y];
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    return { mid, dist };
  };
  const onPointerDown = (e: ReactPointerEvent) => {
    const [x, y] = local(e);
    pointers.current.set(e.pointerId, { x, y });
    const { mid, dist } = snapshot();
    gesture.current = { view, dist, mid, start: [x, y], moved: gesture.current?.moved ?? false };
    if (pointers.current.size === 1) gesture.current.moved = false;
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    const [x, y] = local(e);
    pointers.current.set(e.pointerId, { x, y });
    const g = gesture.current;
    if (!g.moved && Math.hypot(x - g.start[0], y - g.start[1]) < 5 && pointers.current.size === 1) return;
    const { mid, dist } = snapshot();
    const { w, h } = size();
    if (pointers.current.size > 1 && g.dist > 0) {
      g.moved = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const zoomed = zoomAt(g.view, dist / g.dist, g.mid[0], g.mid[1], w, h);
      setView(clampView({ ...zoomed, x: zoomed.x + mid[0] - g.mid[0], y: zoomed.y + mid[1] - g.mid[1] }, w, h));
    } else if (g.view.scale > 1) {
      g.moved = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setView(clampView({ ...g.view, x: g.view.x + mid[0] - g.mid[0], y: g.view.y + mid[1] - g.mid[1] }, w, h));
    }
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size && gesture.current) {
      const { mid, dist } = snapshot();
      gesture.current = { ...gesture.current, view, mid, dist };
    }
  };
  // A drag or pinch must not also count as a tap on a place.
  const onClickCapture = (e: ReactMouseEvent) => {
    if (gesture.current?.moved) {
      e.stopPropagation();
      e.preventDefault();
      gesture.current.moved = false;
    }
  };

  const zoomed = view.scale > 1;
  return (
    <div className="relative bg-[#10131a]">
      <div className="flex justify-center p-2 sm:p-3">
        <div
          ref={box}
          className={cn('relative w-full overflow-hidden', fixedScale ? '' : map.style === 'schematic' ? 'max-w-3xl' : 'max-w-2xl', zoomed ? 'cursor-grab touch-none active:cursor-grabbing' : 'touch-pan-y')}
          style={{
            aspectRatio: map.style === 'schematic' ? `${map.width + 2} / ${map.height + 2}` : `${map.width} / ${map.height}`,
            ...(fixedScale ? { width: map.width * fixedScale, maxWidth: '100%' } : { maxHeight: '70vh' }),
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClickCapture={onClickCapture}
          onDoubleClick={(e) => {
            const { r } = size();
            zoomBy(zoomed && view.scale >= MAX_ZOOM ? 1 / MAX_ZOOM : 2, [e.clientX - r.left, e.clientY - r.top]);
          }}
        >
          <div className="h-full w-full origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
            {children}
          </div>
        </div>
      </div>
      <div className="absolute right-2 bottom-2 flex flex-col gap-1 sm:right-3 sm:bottom-3">
        <Button size="icon-sm" aria-label="Zoom in" onClick={() => zoomBy(1.6)} disabled={view.scale >= MAX_ZOOM}>
          <Plus size={16} aria-hidden />
        </Button>
        <Button size="icon-sm" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.6)} disabled={!zoomed}>
          <Minus size={16} aria-hidden />
        </Button>
        {zoomed && (
          <Button size="icon-sm" aria-label="Show the whole map" onClick={() => setView(IDENTITY_VIEW)}>
            <Maximize2 size={14} aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

function MapCanvas({ map, found, names, selected, onSelect }: { map: RegionMapData; found: Set<string>; names: Map<string, string>; selected?: string; onSelect?: (loc: string) => void }) {
  const [broken, setBroken] = useState(false);
  const label = (loc: string) => names.get(loc) ?? placeLabel(map, loc);
  const lit = Object.entries(map.places).filter(([loc]) => found.has(loc));
  // Marked places are buttons: tap / Enter picks the location in the list below.
  const pick = (loc: string) => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': label(loc),
    'aria-pressed': selected === loc,
    className: 'cursor-pointer outline-none focus-visible:[&>*]:stroke-white',
    onClick: () => onSelect?.(selected === loc ? '' : loc),
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect?.(selected === loc ? '' : loc);
      }
    },
  });
  const outline = (w0: number) =>
    selected && map.places[selected]
      ? map.places[selected].map(([x, y, w, h], i) => <rect key={`sel${i}`} x={x - w0} y={y - w0} width={w + 2 * w0} height={h + 2 * w0} fill="none" stroke="#fff" strokeWidth={w0} className="pointer-events-none" />)
      : null;

  if (map.style === 'schematic') {
    const lit = Object.entries(map.places).filter(([loc]) => found.has(loc));
    return (
      <svg viewBox={`-1 -1 ${map.width + 2} ${map.height + 2}`} className="block h-full w-full" role="group" aria-label={`${map.name} schematic map`}>
        <SchematicBase map={map} label={label} />
        {lit.map(([loc, rects]) =>
          rects.map(([x, y, w, h], i) =>
            map.kinds?.[loc] === 'zone' ? (
              // Whole areas (Obsidian Fieldlands, a Lumiose district…): lit as an outline.
              <g key={loc + i} {...pick(loc)}>
                <title>{label(loc)}</title>
                <rect x={x} y={y} width={w} height={h} rx={0.8} fill="#ff5d5d18" stroke="#ff5d5d" strokeWidth={0.35} className="area-glow" />
              </g>
            ) : (
              <g key={loc + i} {...pick(loc)}>
                <title>{label(loc)}</title>
                <rect className="area-glow" x={x - 0.1} y={y - 0.1} width={w + 0.2} height={h + 0.2} rx={0.3} fill="#ff5d5d" fillOpacity={0.55} stroke="#ff5d5d" strokeWidth={0.15} />
                <circle className="area-ring pointer-events-none" cx={x + w / 2} cy={y + h / 2} r={Math.min(Math.max(w, h) / 2 + 0.9, 3)} fill="none" stroke="#ff5d5d" strokeWidth={0.3} />
              </g>
            ),
          ),
        )}
        {outline(0.3)}
      </svg>
    );
  }

  if (broken)
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-white/80">
        The {map.name} map image couldn’t load (offline in this build?). The locations are listed below.
      </div>
    );

  return (
    <svg viewBox={`0 0 ${map.width} ${map.height}`} className="block h-full w-full" style={{ imageRendering: map.smooth ? 'auto' : 'pixelated' }} role="group" aria-label={`${map.name} map`}>
      <image href={asset(map.image!)} width={map.width} height={map.height} style={{ imageRendering: map.smooth ? 'auto' : 'pixelated' }} onError={() => setBroken(true)} />
      {Object.entries(map.places)
        .filter(([loc]) => !found.has(loc))
        .map(([loc, rects]) =>
          rects.map(([x, y, w, h], i) => (
            <rect key={loc + i} x={x} y={y} width={w} height={h} fill="transparent">
              <title>{label(loc)}</title>
            </rect>
          )),
        )}
      {lit.map(([loc, rects]) => (
        <g key={loc} {...pick(loc)}>
          <title>{label(loc)}</title>
          {rects.map(([x, y, w, h], i) =>
            map.style === 'nest' ? (
              // Gen 1–2: the game's own blinking nest sprite, pixel for pixel.
              <g key={i} className="nest-blink" transform={`translate(${x + w / 2 - 4} ${y + h / 2 - 4})`}>
                <rect x={-0.5} y={-0.5} width={9} height={9} fill="#fff" opacity={0.85} />
                {(map.nestIcon ?? FALLBACK_NEST).flatMap((row, py) =>
                  [...row].map((c, px) => (c === '.' ? null : <rect key={`${px}-${py}`} x={px} y={py} width={1} height={1} fill={c === '#' ? '#101010' : '#6b6b6b'} />)),
                )}
              </g>
            ) : (
              // Gen 3–4: the glowing area squares.
              <rect key={i} className="area-glow" x={x} y={y} width={w} height={h} fill="#ff4a4a" stroke="#ffd0d0" strokeWidth={0.8} />
            ),
          )}
        </g>
      ))}
      {outline(1)}
    </svg>
  );
}

const FALLBACK_NEST = ['.######.', '#......#', '#.####.#', '#.#..#.#', '#.#..#.#', '#.####.#', '#......#', '.######.'];

