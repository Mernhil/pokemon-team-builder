import { useId, useMemo, type ReactNode } from 'react';
import type { RegionMapData } from './RegionMap';

/**
 * The drawn backdrop for the hand-placed schematic regions (Generation 5 onward, which have no
 * decompiled map to render): shaded sea, an organic coastline grown from the region's outline and its
 * places, textured land, trails for routes, and a small icon per kind of place. Pure vectors in grid
 * units, so it stays crisp at any zoom. Callers lay their own highlight / interaction on top.
 */

interface Theme {
  sea: [string, string];
  shallow: string;
  beach: string;
  grass: string;
  /** RGB (0–1) of the large soft patches on the land. */
  patch: [number, number, number];
  /** RGB (0–1) and strength of the fine grain. */
  speck: [number, number, number, number];
  road: string;
  roadCase: string;
  ink: string;
  label: string;
  halo: string;
}

const LAND: Theme = {
  sea: ['#1d5f93', '#2f86bd'],
  shallow: '#8fd3ec',
  beach: '#eadfae',
  grass: '#7fae5a',
  patch: [0.5, 0.8, 0.4],
  speck: [0.16, 0.34, 0.12, 0.9],
  road: '#f6e7b8',
  roadCase: '#7a5b34',
  ink: '#4b3621',
  label: '#ffffff',
  halo: '#13263a',
};
/** Lumiose City: paved ground, no sea. */
const CITY: Theme = { ...LAND, sea: ['#1a2230', '#26324a'], shallow: '#3b4b6b', beach: '#9e978a', grass: '#cbc4b2', patch: [0.9, 0.87, 0.78], speck: [0.4, 0.38, 0.34, 0.35], road: '#f4efe2', roadCase: '#6c6558', ink: '#3d3a33' };
/** The Terarium: a glass dome around four biomes. */
const DOME: Theme = { ...LAND, sea: ['#0f3b4a', '#1b5d70'], shallow: '#67c8c0', beach: '#d9e9d2', grass: '#8fc08a', patch: [0.7, 0.9, 0.55] };
const THEMES: Record<string, Theme> = { lumiose: CITY, 'paldea-terarium': DOME };

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
/** A small seeded generator, so a place always draws the same trees and peaks. */
const rng = (seed: string) => {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type Rect = [number, number, number, number];
const kindOf = (map: RegionMapData, loc: string) => map.kinds?.[loc] ?? 'route';
const nameOf = (map: RegionMapData, loc: string, label: (loc: string) => string) => map.labels?.[loc] ?? label(loc);
const isCity = (name: string, [, , w, h]: Rect) => /\bcity\b|metropolis|megalopolis|lumiose/i.test(name) || w * h >= 4;

export function SchematicBase({ map, label, children }: { map: RegionMapData; label: (loc: string) => string; children?: ReactNode }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const theme = THEMES[map.id] ?? LAND;
  const seed = hash(map.id) % 97;
  const W = map.width, H = map.height;
  const entries = useMemo(() => Object.entries(map.places), [map]);

  // What the coast is grown from: the authored outline plus a margin around every place that sits on land.
  const grown = entries.flatMap(([loc, rects]) => {
    const k = kindOf(map, loc);
    return k === 'sea' || k === 'zone' ? [] : rects.map((r, i) => ({ key: `${loc}${i}`, r, pad: k === 'route' ? 0.7 : 1.1 }));
  });

  const draw = (kinds: string[], render: (loc: string, r: Rect, i: number, name: string) => ReactNode) =>
    entries.flatMap(([loc, rects]) => (kinds.includes(kindOf(map, loc)) ? rects.map((r, i) => render(loc, r, i, nameOf(map, loc, label))) : []));

  // The compass goes in whichever corner has the fewest places near it.
  const corners = [[2.4, 2.4], [W - 2.4, 2.4], [2.4, H - 2.4], [W - 2.4, H - 2.4]];
  const crowd = (cx: number, cy: number) => entries.reduce((n, [, rects]) => n + rects.filter(([x, y, w, h]) => Math.abs(x + w / 2 - cx) < 4 + w / 2 && Math.abs(y + h / 2 - cy) < 4 + h / 2).length, 0);
  const [cx0, cy0] = corners.reduce((best, c) => (crowd(c[0], c[1]) < crowd(best[0], best[1]) ? c : best));
  const compassSpot = { x: cx0, y: cy0 };

  const cities = entries.filter(([loc, rects]) => kindOf(map, loc) === 'town' && isCity(nameOf(map, loc, label), rects[0]));
  const cityIds = new Set(cities.map(([loc]) => loc));

  return (
    <>
      <defs>
        <linearGradient id={`${uid}sea`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={theme.sea[0]} />
          <stop offset="1" stopColor={theme.sea[1]} />
        </linearGradient>
        <pattern id={`${uid}wave`} width="3.2" height="1.6" patternUnits="userSpaceOnUse">
          <path d="M0 0.9 q0.8 -0.55 1.6 0 t1.6 0" fill="none" stroke="#fff" strokeOpacity="0.09" strokeWidth="0.1" />
        </pattern>
        {/* One filter makes the whole landmass: roughen, round off and threshold the black shapes, then shade shallow water, beach, grass and speckle from the result. */}
        <filter id={`${uid}land`} filterUnits="userSpaceOnUse" x={-1} y={-1} width={W + 2} height={H + 2} colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.17" numOctaves="2" seed={seed} result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="1.5" xChannelSelector="R" yChannelSelector="G" result="rough" />
          <feGaussianBlur in="rough" stdDeviation="0.6" result="soft" />
          <feColorMatrix in="soft" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 22 -10" result="land" />
          <feMorphology in="land" operator="dilate" radius="1.5" result="wide" />
          <feGaussianBlur in="wide" stdDeviation="0.75" result="wideSoft" />
          <feFlood floodColor={theme.shallow} floodOpacity="0.5" />
          <feComposite in2="wideSoft" operator="in" result="shallow" />
          <feMorphology in="land" operator="dilate" radius="0.45" result="rim" />
          <feFlood floodColor={theme.beach} />
          <feComposite in2="rim" operator="in" result="beach" />
          <feFlood floodColor={theme.grass} />
          <feComposite in2="land" operator="in" result="grass" />
          <feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="3" seed={seed + 3} result="blotch" />
          <feColorMatrix in="blotch" type="matrix" values={`0 0 0 0 ${theme.patch[0]}  0 0 0 0 ${theme.patch[1]}  0 0 0 0 ${theme.patch[2]}  0 0 0 1.5 -0.55`} result="blotchTint" />
          <feComposite in="blotchTint" in2="land" operator="in" result="patches" />
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed={seed + 7} result="grain" />
          <feColorMatrix in="grain" type="matrix" values={`0 0 0 0 ${theme.speck[0]}  0 0 0 0 ${theme.speck[1]}  0 0 0 0 ${theme.speck[2]}  0 0 0 ${theme.speck[3]} -0.3`} result="grainTint" />
          <feComposite in="grainTint" in2="land" operator="in" result="speckle" />
          <feMerge>
            <feMergeNode in="shallow" />
            <feMergeNode in="beach" />
            <feMergeNode in="grass" />
            <feMergeNode in="patches" />
            <feMergeNode in="speckle" />
          </feMerge>
        </filter>
        <filter id={`${uid}shadow`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0.06" dy="0.12" stdDeviation="0.1" floodColor="#1b1206" floodOpacity="0.45" />
        </filter>
      </defs>

      <rect x={-1} y={-1} width={W + 2} height={H + 2} fill={`url(#${uid}sea)`} />
      <rect x={-1} y={-1} width={W + 2} height={H + 2} fill={`url(#${uid}wave)`} />
      <g filter={`url(#${uid}land)`}>
        {map.land?.map((d, i) => <path key={i} d={d} fill="#000" />)}
        {grown.map(({ key, r: [x, y, w, h], pad }) => <rect key={key} x={x - pad} y={y - pad} width={w + 2 * pad} height={h + 2 * pad} rx={pad} fill="#000" />)}
      </g>

      {/* Zones (whole areas): a faint tint and a dashed boundary. */}
      {draw(['zone'], (loc, [x, y, w, h], i) => (
        <rect key={loc + i} x={x} y={y} width={w} height={h} rx={0.8} fill={ZONE_TINT[hash(loc) % ZONE_TINT.length]} fillOpacity={0.1} stroke="#fff" strokeOpacity={0.45} strokeWidth={0.14} strokeDasharray="0.7 0.5" />
      ))}

      {/* Water: sea routes as dashed wake lines, lakes as pools. */}
      {draw(['sea'], (loc, [x, y, w, h], i) => <line key={loc + i} {...along([x, y, w, h])} stroke="#e8f6ff" strokeOpacity={0.85} strokeWidth={0.34} strokeDasharray="0.7 0.55" strokeLinecap="round" />)}
      {draw(['lake'], (loc, [x, y, w, h], i) => (
        <g key={loc + i}>
          <rect x={x + 0.1} y={y + 0.1} width={w - 0.2} height={h - 0.2} rx={Math.min(w, h) / 2.2} fill="#58a8dc" stroke="#d9f0ff" strokeWidth={0.14} />
          <path d={`M${x + w * 0.22} ${y + h * 0.4} q${w * 0.16} -${Math.min(0.35, h * 0.2)} ${w * 0.32} 0`} fill="none" stroke="#fff" strokeOpacity={0.65} strokeWidth={0.1} strokeLinecap="round" />
        </g>
      ))}
      {draw(['snow'], (loc, [x, y, w, h], i) => <rect key={loc + i} x={x + 0.1} y={y + 0.1} width={w - 0.2} height={h - 0.2} rx={0.8} fill="#eef5fc" fillOpacity={0.92} stroke="#bcd3ea" strokeWidth={0.14} />)}

      {/* Forests and mountains: scattered trees and peaks. */}
      {draw(['forest'], (loc, r, i) => <Forest key={loc + i} loc={loc + i} r={r} />)}
      {draw(['mountain'], (loc, r, i) => <Peaks key={loc + i} loc={loc + i} r={r} />)}

      {/* Routes: a trail with a dark casing; one cell wide runs edge to edge so it meets its neighbours. */}
      <g strokeLinecap="round" strokeLinejoin="round" fill="none">
        {draw(['route'], (loc, r, i) =>
          r[2] > 1.4 && r[3] > 1.4 ? (
            <rect key={loc + i} x={r[0] + 0.15} y={r[1] + 0.15} width={r[2] - 0.3} height={r[3] - 0.3} rx={0.9} fill={theme.road} fillOpacity={0.5} stroke={theme.roadCase} strokeOpacity={0.5} strokeWidth={0.1} strokeDasharray="0.5 0.35" />
          ) : (
            <g key={loc + i}>
              <line {...along(r)} stroke={theme.roadCase} strokeWidth={0.62} />
              <line {...along(r)} stroke={theme.road} strokeWidth={0.4} />
            </g>
          ),
        )}
      </g>

      {draw(['cave'], (loc, r, i) => <Cave key={loc + i} r={r} ink={theme.ink} />)}
      {draw(['dungeon'], (loc, r, i) => <Ruin key={loc + i} r={r} ink={theme.ink} />)}
      {draw(['landmark'], (loc, [x, y, w, h], i) => (
        <g key={loc + i} filter={`url(#${uid}shadow)`}>
          <circle cx={x + w / 2} cy={y + h / 2} r={0.5} fill="#f4c542" stroke={theme.ink} strokeWidth={0.13} />
          <circle cx={x + w / 2} cy={y + h / 2} r={0.18} fill={theme.ink} />
        </g>
      ))}
      {draw(['town'], (loc, r, i) => (
        <g key={loc + i} filter={`url(#${uid}shadow)`}>
          {cityIds.has(loc) ? <City r={r} ink={theme.ink} /> : <Village loc={loc} r={r} ink={theme.ink} />}
        </g>
      ))}

      {/* Names of towns and cities. */}
      {draw(['town'], (loc, [x, y, w, h], i, name) => {
        const city = cityIds.has(loc);
        const nearTop = y < 2.2;
        const text = name.split(' / ')[0].replace(/ (City|Town)$/, '');
        const size = city ? 1.05 : w * h > 1 ? 0.9 : 0.8;
        // Keep the name inside the map: roughly half a size-unit per letter.
        const half = (text.length * size * 0.29) + 0.3;
        const cx = Math.min(Math.max(x + w / 2, half), W - half);
        return (
          <text key={`t${loc}${i}`} x={cx} y={nearTop ? y + h + 0.95 : y - 0.35} fontSize={size} fontWeight={600} textAnchor="middle" fill={theme.label} stroke={theme.halo} strokeWidth={0.26} strokeLinejoin="round" paintOrder="stroke" className="pointer-events-none select-none">
            {text}
          </text>
        );
      })}

      <Compass {...compassSpot} />
      {children}
    </>
  );
}

const ZONE_TINT = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#c77dff'];

/** A line along the longer side of a rect, edge to edge. */
function along([x, y, w, h]: Rect) {
  return w >= h ? { x1: x, y1: y + h / 2, x2: x + w, y2: y + h / 2 } : { x1: x + w / 2, y1: y, x2: x + w / 2, y2: y + h };
}

function Forest({ loc, r: [x, y, w, h] }: { loc: string; r: Rect }) {
  const rand = rng(loc);
  const n = Math.max(3, Math.round(w * h * 1.5));
  const trees = Array.from({ length: n }, () => ({ cx: x + 0.4 + rand() * Math.max(0.01, w - 0.8), cy: y + 0.4 + rand() * Math.max(0.01, h - 0.8), r: 0.36 + rand() * 0.16, d: rand() })).sort((a, b) => a.cy - b.cy);
  return (
    <g>
      <rect x={x + 0.05} y={y + 0.05} width={w - 0.1} height={h - 0.1} rx={0.6} fill="#2f6b36" fillOpacity={0.45} />
      {trees.map((t, i) => (
        <g key={i}>
          <circle cx={t.cx} cy={t.cy + 0.08} r={t.r} fill="#17381d" fillOpacity={0.5} />
          <circle cx={t.cx} cy={t.cy} r={t.r} fill={t.d > 0.5 ? '#3f8a45' : '#2f7a3b'} stroke="#1f4d27" strokeWidth={0.06} />
          <circle cx={t.cx - t.r * 0.3} cy={t.cy - t.r * 0.3} r={t.r * 0.32} fill="#8cd07b" fillOpacity={0.6} />
        </g>
      ))}
    </g>
  );
}

function Peaks({ loc, r: [x, y, w, h] }: { loc: string; r: Rect }) {
  const rand = rng(loc);
  const n = Math.max(2, Math.round((w * h) / 2.5));
  const peaks = Array.from({ length: n }, () => ({ cx: x + 0.5 + rand() * Math.max(0.01, w - 1), by: y + 0.9 + rand() * Math.max(0.01, h - 1), s: 0.55 + rand() * 0.5 })).sort((a, b) => a.by - b.by);
  return (
    <g>
      {peaks.map((p, i) => (
        <g key={i}>
          <path d={`M${p.cx - p.s} ${p.by} L${p.cx} ${p.by - p.s * 1.25} L${p.cx + p.s} ${p.by} Z`} fill="#8d8575" stroke="#4e473b" strokeWidth={0.1} strokeLinejoin="round" />
          <path d={`M${p.cx} ${p.by - p.s * 1.25} L${p.cx + p.s} ${p.by} L${p.cx + p.s * 0.1} ${p.by} Z`} fill="#6e675a" />
          <path d={`M${p.cx - p.s * 0.32} ${p.by - p.s * 0.85} L${p.cx} ${p.by - p.s * 1.25} L${p.cx + p.s * 0.32} ${p.by - p.s * 0.85} L${p.cx} ${p.by - p.s * 0.7} Z`} fill="#fff" fillOpacity={0.92} />
        </g>
      ))}
    </g>
  );
}

function Cave({ r: [x, y, w, h], ink }: { r: Rect; ink: string }) {
  const cx = x + w / 2, cy = y + h / 2, s = Math.max(0.5, Math.min(Math.max(w, h) / 2, 0.8));
  return (
    <g>
      <path d={`M${cx - s} ${cy + s * 0.6} Q${cx - s * 0.9} ${cy - s} ${cx} ${cy - s} Q${cx + s * 0.9} ${cy - s} ${cx + s} ${cy + s * 0.6} Z`} fill="#8a8272" stroke={ink} strokeWidth={0.12} strokeLinejoin="round" />
      <path d={`M${cx - s * 0.42} ${cy + s * 0.6} Q${cx - s * 0.42} ${cy - s * 0.3} ${cx} ${cy - s * 0.3} Q${cx + s * 0.42} ${cy - s * 0.3} ${cx + s * 0.42} ${cy + s * 0.6} Z`} fill="#1e1a14" />
    </g>
  );
}

function Ruin({ r: [x, y, w, h], ink }: { r: Rect; ink: string }) {
  const cx = x + w / 2, cy = y + h / 2, s = Math.max(0.55, Math.min(Math.max(w, h) / 2, 0.85));
  return (
    <g stroke={ink} strokeWidth={0.1} strokeLinejoin="round">
      <rect x={cx - s * 0.8} y={cy - s * 0.35} width={s * 1.6} height={s * 1.1} fill="#a9a08d" />
      {[-0.8, -0.2, 0.4].map((o, i) => <rect key={i} x={cx + s * o} y={cy - s * 0.7} width={s * 0.4} height={s * 0.35} fill="#a9a08d" />)}
      <rect x={cx - s * 0.2} y={cy + s * 0.1} width={s * 0.4} height={s * 0.65} fill="#2a241b" stroke="none" />
    </g>
  );
}

function Village({ loc, r: [x, y, w, h], ink }: { loc: string; r: Rect; ink: string }) {
  const rand = rng(loc);
  const cx = x + w / 2, cy = y + h / 2;
  const roofs = ['#c8473a', '#d9803b', '#3f78b5'];
  const spots: [number, number][] = [[-0.36, 0.12], [0.34, 0.1], [0, -0.3]];
  return (
    <g stroke={ink} strokeWidth={0.1} strokeLinejoin="round">
      <ellipse cx={cx} cy={cy + 0.12} rx={Math.max(0.78, w / 2)} ry={Math.max(0.62, h / 2)} fill="#efe3bd" />
      {spots.map(([dx, dy], i) => (
        <g key={i}>
          <rect x={cx + dx - 0.2} y={cy + dy - 0.06} width={0.4} height={0.3} fill="#fbf6e6" />
          <path d={`M${cx + dx - 0.27} ${cy + dy - 0.05} L${cx + dx} ${cy + dy - 0.32} L${cx + dx + 0.27} ${cy + dy - 0.05} Z`} fill={roofs[Math.floor(rand() * roofs.length)]} />
        </g>
      ))}
    </g>
  );
}

function City({ r: [x, y, w, h], ink }: { r: Rect; ink: string }) {
  const cx = x + w / 2, cy = y + h / 2;
  const rw = Math.max(1.5, w), rh = Math.max(1.2, h);
  const bars = Math.max(4, Math.round(rw * 2));
  return (
    <g stroke={ink} strokeWidth={0.1} strokeLinejoin="round">
      <rect x={cx - rw / 2} y={cy - rh / 2} width={rw} height={rh} rx={0.3} fill="#efe3bd" />
      {Array.from({ length: bars }, (_, i) => {
        const bw = (rw - 0.5) / bars, bh = 0.5 + ((i * 7 + hash(`${x}${y}`)) % 5) * 0.13;
        return <rect key={i} x={cx - rw / 2 + 0.25 + i * bw} y={cy + rh / 2 - 0.25 - bh} width={bw * 0.82} height={bh} fill={i % 2 ? '#8ea7c0' : '#b9c8d8'} />;
      })}
    </g>
  );
}

function Compass({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} className="pointer-events-none" opacity={0.85}>
      <circle r={1.05} fill="#0b1a2b" fillOpacity={0.45} stroke="#fff" strokeOpacity={0.6} strokeWidth={0.08} />
      <path d="M0 -0.95 L0.22 0 L0 0.95 L-0.22 0 Z" fill="#fff" fillOpacity={0.35} />
      <path d="M0 -0.95 L0.22 0 L-0.22 0 Z" fill="#ef6a5a" />
      <text y={-1.25} fontSize={0.7} fontWeight={700} textAnchor="middle" fill="#fff" stroke="#0b1a2b" strokeWidth={0.16} paintOrder="stroke">N</text>
    </g>
  );
}
