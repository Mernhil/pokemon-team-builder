import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { neighbour, unionOutline, type Dir } from '@/domain/regionMaps';
import type { MapSkin } from '@/domain/mapSkins';
import { MapViewport, asset, type RegionMapData } from '../pokedex/RegionMap';
import { cn } from '../ui/styles';

interface Props {
  map: RegionMapData;
  skin: MapSkin;
  /** Location ids that exist in the atlas (only these are interactive). */
  locations: Set<string>;
  names: (loc: string) => string;
  pinned?: string;
  onPin: (loc: string) => void;
  hovered?: string;
  onHover: (loc: string | undefined) => void;
  /** Filter / search matches: glow on these, dim the rest. null = no filter. */
  matches: Set<string> | null;
  done: Set<string>;
}

const ARROWS: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

/**
 * The interactive game map: the rendered in-game image (integer upscale, `image-rendering: pixelated`)
 * with one focusable shape per location. Hover / focus previews, click / Enter / tap pins, arrow keys
 * move between locations. Shape ids (`atlas-loc-<id>`) are the location ids of the atlas data.
 */
export function AtlasMap({ map, skin, locations, names, pinned, onPin, hovered, onHover, matches, done }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const fixedScale = skin.pixelPerfect && avail ? Math.max(1, Math.floor(avail / map.width)) : undefined;
  // Fit into the available width, but never taller than the viewport allows (whole-number scales only).
  const scale = fixedScale && Math.min(fixedScale, Math.max(1, Math.floor((typeof window === 'undefined' ? 900 : window.innerHeight * 0.8) / map.height)));

  const places = useMemo(() => Object.fromEntries(Object.entries(map.places).filter(([l]) => locations.has(l))), [map, locations]);
  const outlines = useMemo(() => Object.fromEntries(Object.entries(places).map(([l, r]) => [l, unionOutline(r, skin.cell)])), [places, skin.cell]);
  const [broken, setBroken] = useState(false);

  const focusLoc = (loc: string) => document.getElementById(`atlas-loc-${loc}`)?.focus();
  const onKey = (loc: string) => (e: ReactKeyboardEvent) => {
    const dir = ARROWS[e.key];
    if (dir) {
      e.preventDefault();
      const next = neighbour(places, loc, dir);
      if (next) focusLoc(next);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPin(loc);
    } else if (e.key === 'Escape') onHover(undefined);
  };

  const cur = pinned ?? hovered;
  const pal = skin.palette;
  return (
    <div ref={wrap} className="w-full overflow-hidden rounded-xl border border-border bg-[#10131a]">
      <MapViewport map={map} focus={pinned && map.places[pinned] ? pinned : undefined} fixedScale={scale}>
        {broken ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-white/80">The map image couldn’t load (offline in this build?).</div>
        ) : (
          <svg viewBox={`0 0 ${map.width} ${map.height}`} className="block h-full w-full" style={{ imageRendering: 'pixelated' }} role="group" aria-label={`${map.name} map. Arrow keys move between locations, Enter opens one.`}>
            <defs>
              {matches && (
                <mask id="atlas-dim">
                  <rect width={map.width} height={map.height} fill="#fff" />
                  {[...matches].flatMap((l) => (map.places[l] ?? []).map(([x, y, w, h], i) => <rect key={l + i} x={x - 1} y={y - 1} width={w + 2} height={h + 2} fill="#000" />))}
                </mask>
              )}
            </defs>
            <image href={asset(map.image!)} width={map.width} height={map.height} style={{ imageRendering: 'pixelated' }} onError={() => setBroken(true)} />
            {matches && <rect width={map.width} height={map.height} fill={pal.dim} mask="url(#atlas-dim)" className="pointer-events-none" />}
            {Object.entries(places).map(([loc, rects]) => {
              const isPinned = pinned === loc;
              const isMatch = !!matches?.has(loc);
              const isDone = done.has(loc);
              return (
                <g
                  key={loc}
                  id={`atlas-loc-${loc}`}
                  data-loc={loc}
                  role="button"
                  tabIndex={0}
                  aria-label={`${names(loc)}${isDone ? ', done' : ''}${isMatch ? ', matches filter' : ''}`}
                  aria-pressed={isPinned}
                  className="cursor-pointer outline-none [&:focus-visible>path.frame]:stroke-[1.4]"
                  onClick={() => onPin(loc)}
                  onKeyDown={onKey(loc)}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && onHover(loc)}
                  onPointerLeave={(e) => e.pointerType === 'mouse' && onHover(undefined)}
                  onFocus={() => onHover(loc)}
                  onBlur={() => onHover(undefined)}
                >
                  {rects.map(([x, y, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} fill="transparent" />)}
                  {/* One soft shape per place: a straight route is a single rectangle, not a square per block. */}
                  <path
                    className={cn('pointer-events-none transition-opacity', isMatch && 'area-glow')}
                    d={outlines[loc]}
                    fill={isMatch ? pal.match : pal.cursor}
                    fillOpacity={isMatch ? 0.4 : isPinned ? 0.2 : cur === loc ? 0.12 : 0}
                    stroke="none"
                  />
                  {(isPinned || cur === loc) && (
                    <>
                      <path className="pointer-events-none" d={outlines[loc]} fill="none" stroke="#10131a" strokeOpacity={0.45} strokeWidth={2.4} strokeLinejoin="round" />
                      <path className="frame pointer-events-none" d={outlines[loc]} fill="none" stroke={pal.cursor} strokeOpacity={isPinned ? 0.95 : 0.7} strokeWidth={1} strokeLinejoin="round" />
                    </>
                  )}
                  {isDone && <circle className="pointer-events-none" cx={rects[0][0] + rects[0][2] - 1} cy={rects[0][1] + 1} r={1.6} fill={pal.done} stroke="#10131a" strokeOpacity={0.6} strokeWidth={0.4} />}
                </g>
              );
            })}
          </svg>
        )}
      </MapViewport>
      <p className={cn('flex flex-wrap justify-between gap-x-3 px-3 py-1.5 text-xs text-muted')}>
        <span>{skin.label} · the game’s own map, from the pret decompilation{skin.stylized ? ' (stylized recreation)' : ''}</span>
        {fixedScale ? <span>{scale}× pixel scale</span> : null}
      </p>
    </div>
  );
}

