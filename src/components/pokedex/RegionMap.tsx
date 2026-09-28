import { useEffect, useMemo, useState } from 'react';
import { SIDE_LOADED_DATA, fetchGenerated } from '@/data/generated-loader';
import type { Encounter } from '@/domain/pokedex';
import { cn } from '../ui/styles';

type Rect = [number, number, number, number];

interface RegionMapData {
  id: string;
  name: string;
  width: number;
  height: number;
  image?: string;
  style: 'nest' | 'area' | 'schematic';
  places: Record<string, Rect[]>;
  nestIcon?: string[];
  land?: string[];
  kinds?: Record<string, string>;
  labels?: Record<string, string>;
  source: string;
}
interface MapsFile {
  maps: Record<string, RegionMapData>;
  /** PokeAPI version id → map ids shown for that game. */
  games: Record<string, string[]>;
}

let mapsPromise: Promise<MapsFile> | undefined;
const loadMaps = () =>
  (mapsPromise ??= SIDE_LOADED_DATA ? fetchGenerated<MapsFile>('maps') : import('@/data/generated/maps.json').then((m) => m.default as unknown as MapsFile));
const asset = (path: string) => `${import.meta.env.BASE_URL ?? './'}${path}`.replace(/^\/\//, '/');

const SOURCE_LABEL: Record<string, string> = {
  'pret/pokered': 'Red / Blue town map',
  'pret/pokecrystal': 'Crystal Pokégear map',
  'pret/pokeemerald': 'Emerald Pokédex area map',
  'pret/pokefirered': 'FireRed / LeafGreen region map',
  schematic: 'Schematic map',
};

/**
 * The Area map: the game's region map with the Pokémon's locations marked the way that game's
 * Pokédex marked them — blinking nest icons in Gen 1–2, glowing squares from Gen 3 — or, for regions
 * without a disassembled map, a schematic of the region with its locations highlighted.
 */
export function RegionMaps({ game, encounters }: { game: string; encounters: Encounter[] }) {
  const [file, setFile] = useState<MapsFile | null>(null);
  useEffect(() => {
    let alive = true;
    loadMaps().then((f) => alive && setFile(f));
    return () => {
      alive = false;
    };
  }, []);

  const found = useMemo(() => new Set(encounters.map((e) => e.area.loc)), [encounters]);
  const maps = useMemo(() => (file?.games[game] ?? []).map((id) => file!.maps[id]).filter(Boolean), [file, game]);
  const hits = (m: RegionMapData) => [...found].filter((l) => m.places[l]).length;
  const best = maps.length ? maps.reduce((a, b) => (hits(b) > hits(a) ? b : a)) : undefined;
  const [picked, setPicked] = useState<string>();
  const current = maps.find((m) => m.id === picked) ?? best;

  if (!file) return <div className="aspect-[3/2] w-full animate-pulse rounded-xl bg-surface-2" />;
  if (!current) return null;
  const offMap = [...new Map(encounters.filter((e) => !maps.some((m) => m.places[e.area.loc])).map((e) => [e.area.loc, e.area.name])).values()];

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      {maps.length > 1 && (
        <div className="flex border-b border-border" role="tablist" aria-label="Map">
          {maps.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={m.id === current.id}
              onClick={() => setPicked(m.id)}
              className={cn('flex-1 border-b-2 px-2 py-1.5 text-xs font-semibold', m.id === current.id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}
            >
              {m.name}
              <span className="ml-1 font-mono font-normal text-muted">{hits(m)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex justify-center bg-[#10131a] p-2 sm:p-3">
        <MapCanvas map={current} found={found} />
      </div>
      <p className="flex flex-wrap justify-between gap-x-3 px-3 py-1.5 text-xs text-muted">
        <span>
          {SOURCE_LABEL[current.source] ?? current.source}
          {current.source === 'schematic' ? ' · positions approximate' : ' · from the pret disassembly'}
        </span>
        {offMap.length > 0 && <span>Not on this map: {offMap.join(', ')}</span>}
      </p>
    </section>
  );
}

function MapCanvas({ map, found }: { map: RegionMapData; found: Set<string> }) {
  const label = (loc: string) => map.labels?.[loc] ?? loc.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const lit = Object.entries(map.places).filter(([loc]) => found.has(loc));

  if (map.style === 'schematic') {
    const order = ['zone', 'sea', 'snow', 'route', 'forest', 'lake', 'mountain', 'landmark', 'cave', 'dungeon', 'town'];
    const entries = Object.entries(map.places).sort(([a], [b]) => order.indexOf(map.kinds?.[a] ?? 'route') - order.indexOf(map.kinds?.[b] ?? 'route'));
    return (
      <svg viewBox={`-1 -1 ${map.width + 2} ${map.height + 2}`} className="h-auto max-h-[70vh] w-full max-w-3xl" role="img" aria-label={`${map.name} map`}>
        <rect x={-1} y={-1} width={map.width + 2} height={map.height + 2} fill="#2c5d8a" />
        {map.land?.map((d, i) => <path key={i} d={d} fill="#6f9a52" stroke="#e8dfb0" strokeWidth={0.25} strokeLinejoin="round" />)}
        {entries.map(([loc, rects]) =>
          rects.map(([x, y, w, h], i) => {
            const kind = map.kinds?.[loc] ?? 'route';
            const on = found.has(loc);
            if (kind === 'zone')
              // Whole areas (Obsidian Fieldlands, a Lumiose district…): an outline, lit as an outline.
              return (
                <rect key={loc + i} x={x} y={y} width={w} height={h} rx={0.6} fill={on ? '#ff5d5d18' : 'none'} stroke={on ? '#ff5d5d' : '#ffffff55'} strokeWidth={on ? 0.35 : 0.18} strokeDasharray={on ? undefined : '0.6 0.5'} className={on ? 'area-glow' : undefined}>
                  <title>{label(loc)}</title>
                </rect>
              );
            return (
              <g key={loc + i}>
                <title>{label(loc)}</title>
                <rect
                  x={x + 0.1}
                  y={y + 0.1}
                  width={w - 0.2}
                  height={h - 0.2}
                  rx={kind === 'town' ? 0.25 : kind === 'lake' ? 0.8 : 0.15}
                  fill={SCHEMATIC_FILL[kind] ?? SCHEMATIC_FILL.route}
                  stroke={kind === 'town' ? '#3b2a1a' : 'none'}
                  strokeWidth={0.15}
                  opacity={on ? 0.35 : 0.95}
                />
                {on && (
                  <>
                    <rect className="area-glow" x={x} y={y} width={w} height={h} rx={0.2} fill="#ff5d5d" />
                    <circle className="area-ring" cx={x + w / 2} cy={y + h / 2} r={Math.min(Math.max(w, h) / 2 + 0.9, 3)} fill="none" stroke="#ff5d5d" strokeWidth={0.3} />
                  </>
                )}
              </g>
            );
          }),
        )}
        {entries
          .filter(([loc]) => map.kinds?.[loc] === 'town')
          .map(([loc, [[x, y, w]]]) => (
            <text key={loc} x={x + w / 2} y={y - 0.3} fontSize={0.9} textAnchor="middle" fill="#fff" stroke="#0008" strokeWidth={0.18} paintOrder="stroke" className="pointer-events-none select-none">
              {label(loc).replace(/ (City|Town)$/, '')}
            </text>
          ))}
      </svg>
    );
  }

  return (
    <svg viewBox={`0 0 ${map.width} ${map.height}`} className="h-auto max-h-[70vh] w-full max-w-2xl" style={{ imageRendering: 'pixelated' }} role="img" aria-label={`${map.name} map`}>
      <image href={asset(map.image!)} width={map.width} height={map.height} style={{ imageRendering: 'pixelated' }} />
      {Object.entries(map.places).map(([loc, rects]) =>
        rects.map(([x, y, w, h], i) => (
          <rect key={loc + i} x={x} y={y} width={w} height={h} fill="transparent">
            <title>{label(loc)}</title>
          </rect>
        )),
      )}
      {lit.map(([loc, rects]) =>
        rects.map(([x, y, w, h], i) =>
          map.style === 'nest' ? (
            // Gen 1–2: the game's own blinking nest sprite, pixel for pixel.
            <g key={loc + i} className="nest-blink" transform={`translate(${x + w / 2 - 4} ${y + h / 2 - 4})`}>
              <title>{label(loc)}</title>
              <rect x={-0.5} y={-0.5} width={9} height={9} fill="#fff" opacity={0.85} />
              {(map.nestIcon ?? FALLBACK_NEST).flatMap((row, py) =>
                [...row].map((c, px) => (c === '.' ? null : <rect key={`${px}-${py}`} x={px} y={py} width={1} height={1} fill={c === '#' ? '#101010' : '#6b6b6b'} />)),
              )}
            </g>
          ) : (
            // Gen 3: the glowing area squares.
            <rect key={loc + i} className="area-glow" x={x} y={y} width={w} height={h} fill="#ff4a4a" stroke="#ffd0d0" strokeWidth={0.8}>
              <title>{label(loc)}</title>
            </rect>
          ),
        ),
      )}
    </svg>
  );
}

const FALLBACK_NEST = ['.######.', '#......#', '#.####.#', '#.#..#.#', '#.#..#.#', '#.####.#', '#......#', '.######.'];

const SCHEMATIC_FILL: Record<string, string> = {
  town: '#e9e2c4',
  route: '#d8b56a',
  sea: '#8cc4ee',
  cave: '#7a5a3a',
  dungeon: '#7a5a3a',
  forest: '#2f6b35',
  lake: '#5aa6e0',
  mountain: '#8d8a7e',
  landmark: '#b77fd1',
  snow: '#e3eef7',
};
