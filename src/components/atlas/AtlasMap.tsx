import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { neighbour, unionOutline, type Dir } from '@/domain/regionMaps';
import type { MapSkin } from '@/domain/mapSkins';
import { MapViewport, asset, type RegionMapData } from '../pokedex/RegionMap';
import { SchematicBase } from '../pokedex/SchematicMap';
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
  /** A run's wild encounter per place: available (ring), used (filled square), none (dash). Shapes, not just colours. */
  marks?: Record<string, 'used' | 'available' | 'none'>;
}

const MARK_TEXT = { used: ', encounter used', available: ', encounter available', none: ', no wild encounters' } as const;

/** Run marker, bottom-left of a place: ring = encounter available, filled square = used, dash = none. Dark outline so it reads on any map. */
function RunMark({ kind, x, y, k }: { kind: 'used' | 'available' | 'none'; x: number; y: number; k: number }) {
  const r = 1.5 * k;
  const common = { className: 'pointer-events-none', stroke: '#10131a', strokeOpacity: 0.85 } as const;
  if (kind === 'none') return <rect {...common} x={x} y={y - 0.5 * k} width={2.6 * k} height={k} fill="#b6bcc9" strokeWidth={0.3 * k} />;
  if (kind === 'used') return <rect {...common} x={x} y={y - 2 * r} width={2 * r} height={2 * r} fill="#ff9f1c" strokeWidth={0.4 * k} />;
  return <circle {...common} cx={x + r} cy={y - r} r={r} fill="#ffffff" fillOpacity={0.25} stroke="#4cc9f0" strokeOpacity={1} strokeWidth={0.8 * k} />;
}

const ARROWS: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

/**
 * The interactive game map: the rendered in-game image (integer upscale, `image-rendering: pixelated`)
 * with one focusable shape per location. Hover / focus previews, click / Enter / tap pins, arrow keys
 * move between locations. Shape ids (`atlas-loc-<id>`) are the location ids of the atlas data.
 */
export function AtlasMap({ map, skin, locations, names, pinned, onPin, hovered, onHover, matches, done, marks }: Props) {
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

  // Schematic maps (Generation 5 onward) are vectors in grid units, with a 1-unit margin; image maps are in pixels.
  const schematic = map.style === 'schematic';
  const vb = schematic ? { x: -1, y: -1, w: map.width + 2, h: map.height + 2 } : { x: 0, y: 0, w: map.width, h: map.height };
  // Stroke widths and marks are drawn for pixel maps; scale them down for grid-unit maps.
  const k = schematic ? 0.2 : 1;

  const places = useMemo(() => Object.fromEntries(Object.entries(map.places).filter(([l]) => locations.has(l))), [map, locations]);
  const outlines = useMemo(() => Object.fromEntries(Object.entries(places).map(([l, r]) => [l, unionOutline(r, skin.cell)])), [places, skin.cell]);
  const [broken, setBroken] = useState(false);

  /** The place under a pointer: among those whose block contains it, the one whose centre is nearest (places can overlap on small maps). */
  const locAt = (e: { clientX: number; clientY: number }, svg: SVGSVGElement): string | undefined => {
    // Screen → map units through the svg's own transform: right however the browser sized the svg box
    // (WebKit can give it another shape than the map, which is then letterboxed) and while zoomed.
    const ctm = svg.getScreenCTM();
    let x: number;
    let y: number;
    if (ctm) {
      ({ x, y } = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse()));
    } else {
      const r = svg.getBoundingClientRect();
      x = vb.x + ((e.clientX - r.left) / r.width) * vb.w;
      y = vb.y + ((e.clientY - r.top) / r.height) * vb.h;
    }
    let best: { id: string; d: number } | undefined;
    for (const [id, rects] of Object.entries(places))
      for (const [rx, ry, rw, rh] of rects) {
        if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) continue;
        const d = Math.hypot(x - (rx + rw / 2), y - (ry + rh / 2));
        if (!best || d < best.d || (d === best.d && id < best.id)) best = { id, d };
      }
    return best?.id;
  };
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
          <svg
            viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
            className="block h-full w-full"
            style={{ imageRendering: schematic || map.smooth ? 'auto' : 'pixelated', cursor: hovered ? 'pointer' : 'default' }}
            onClick={(e) => {
              const l = locAt(e, e.currentTarget);
              if (l) onPin(l);
            }}
            onPointerMove={(e) => {
              if (e.pointerType === 'mouse') onHover(locAt(e, e.currentTarget));
            }}
            onPointerLeave={(e) => e.pointerType === 'mouse' && onHover(undefined)}
            role="group" aria-label={`${map.name} map. Arrow keys move between locations, Enter opens one.`}>
            <defs>
              {matches && (
                <mask id="atlas-dim">
                  <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="#fff" />
                  {[...matches].flatMap((l) => (map.places[l] ?? []).map(([x, y, w, h], i) => <rect key={l + i} x={x - k} y={y - k} width={w + 2 * k} height={h + 2 * k} fill="#000" />))}
                </mask>
              )}
            </defs>
            {schematic ? <SchematicBase map={map} label={names} /> : <image href={asset(map.image!)} width={map.width} height={map.height} style={{ imageRendering: map.smooth ? 'auto' : 'pixelated' }} onError={() => setBroken(true)} />}
            {matches && <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill={pal.dim} mask="url(#atlas-dim)" className="pointer-events-none" />}
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
                  aria-label={`${names(loc)}${isDone ? ', done' : ''}${marks?.[loc] ? MARK_TEXT[marks[loc]] : ''}${isMatch ? ', matches filter' : ''}`}
                  aria-pressed={isPinned}
                  className={cn('pointer-events-none outline-none', schematic ? '[&:focus-visible>path.frame]:stroke-[0.28]' : '[&:focus-visible>path.frame]:stroke-[1.4]')}
                  onKeyDown={onKey(loc)}
                  onFocus={() => onHover(loc)}
                  onBlur={() => onHover(undefined)}
                >
                  {/* pointer hits are resolved by the svg (nearest centre), so these shapes only carry focus */}
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
                      <path className="pointer-events-none" d={outlines[loc]} fill="none" stroke="#10131a" strokeOpacity={0.45} strokeWidth={2.4 * k} strokeLinejoin="round" />
                      <path className="frame pointer-events-none" d={outlines[loc]} fill="none" stroke={pal.cursor} strokeOpacity={isPinned ? 0.95 : 0.7} strokeWidth={k} strokeLinejoin="round" />
                    </>
                  )}
                  {marks?.[loc] && <RunMark kind={marks[loc]} x={rects[0][0] + k} y={rects[0][1] + rects[0][3] - k} k={k} />}
                  {isDone && <circle className="pointer-events-none" cx={rects[0][0] + rects[0][2] - k} cy={rects[0][1] + k} r={1.6 * k} fill={pal.done} stroke="#10131a" strokeOpacity={0.6} strokeWidth={0.4 * k} />}
                </g>
              );
            })}
          </svg>
        )}
      </MapViewport>
      <p className={cn('flex flex-wrap justify-between gap-x-3 px-3 py-1.5 text-xs text-[#a0a5b2]')}>
        <span>{schematic ? `${map.name} · schematic map, not the game’s own; positions approximate` : map.smooth ? `${map.name} · the game’s own artwork (supplied screenshot); positions approximate` : `${skin.label} · the game’s own map, from the pret decompilation`}</span>
        {fixedScale ? <span>{scale}× pixel scale</span> : null}
      </p>
    </div>
  );
}

