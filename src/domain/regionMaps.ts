/**
 * Pure helpers for the Pokédex Area map: which map shows which encounter locations, and the
 * zoom / pan maths of the map viewer. No React, no DOM.
 */

export type Rect = [number, number, number, number];

export interface MapPlaces {
  id: string;
  places: Record<string, Rect[]>;
}

export interface LocationResolution<M extends MapPlaces> {
  /** The map to open first: the one showing the most of the locations (first map on a tie). */
  best?: M;
  /** Locations each map shows. */
  hits: Map<string, string[]>;
  /** Locations no map of the game places (roaming, event islands…), for the "Not on this map" line. */
  offMap: string[];
}

/** Resolve encounter locations against a game's maps (the maps.json `games[game]` list, in order). */
export function resolveLocations<M extends MapPlaces>(maps: M[], locations: Iterable<string>): LocationResolution<M> {
  const locs = [...new Set(locations)];
  const hits = new Map(maps.map((m) => [m.id, locs.filter((l) => m.places[l])]));
  const best = maps.reduce<M | undefined>((a, m) => (!a || hits.get(m.id)!.length > hits.get(a.id)!.length ? m : a), undefined);
  return { best, hits, offMap: locs.filter((l) => !maps.some((m) => m.places[l])) };
}

/** Centre of a location's places (first rectangle's centre when it has several), in map pixels. */
export function placeCenter(rects: Rect[]): [number, number] {
  const [x, y, w, h] = rects[0];
  return [x + w / 2, y + h / 2];
}

// ---------------------------------------------------------------------------
// Viewer: the map fills a box of `w`×`h` CSS px at scale 1; zoom scales it about a point and the
// translation keeps the box covered (no empty margins while zoomed).
// ---------------------------------------------------------------------------

export interface MapView {
  scale: number;
  /** Translation in CSS px, applied before the scale (transform-origin 0 0). */
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;
export const IDENTITY_VIEW: MapView = { scale: 1, x: 0, y: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clampView(v: MapView, w: number, h: number): MapView {
  const scale = clamp(v.scale, MIN_ZOOM, MAX_ZOOM);
  return { scale, x: clamp(v.x, w - w * scale, 0), y: clamp(v.y, h - h * scale, 0) };
}

/** Zoom by `factor` keeping the box point (px, py) fixed under the finger / cursor. */
export function zoomAt(v: MapView, factor: number, px: number, py: number, w: number, h: number): MapView {
  const scale = clamp(v.scale * factor, MIN_ZOOM, MAX_ZOOM);
  const k = scale / v.scale;
  return clampView({ scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k }, w, h);
}

/** Pan so that the point (cx, cy), given as fractions 0–1 of the map, sits in the middle of the box. */
export function centerOn(v: MapView, cx: number, cy: number, w: number, h: number): MapView {
  return clampView({ scale: v.scale, x: w / 2 - cx * w * v.scale, y: h / 2 - cy * h * v.scale }, w, h);
}

// ---------------------------------------------------------------------------
// Keyboard navigation between locations
// ---------------------------------------------------------------------------

export type Dir = 'left' | 'right' | 'up' | 'down';

const centre = (r: Rect[]) => placeCenter(r);

/**
 * The location an arrow key moves to: the nearest candidate whose centre lies in that direction
 * (within a 45° cone, sideways drift weighted double), or undefined at the edge.
 */
export function neighbour(places: Record<string, Rect[]>, from: string, dir: Dir, candidates: Iterable<string> = Object.keys(places)): string | undefined {
  const origin = places[from];
  if (!origin) return undefined;
  const [fx, fy] = centre(origin);
  let best: { id: string; score: number } | undefined;
  for (const id of candidates) {
    if (id === from || !places[id]) continue;
    const [x, y] = centre(places[id]);
    const along = dir === 'left' ? fx - x : dir === 'right' ? x - fx : dir === 'up' ? fy - y : y - fy;
    const across = Math.abs(dir === 'left' || dir === 'right' ? y - fy : x - fx);
    if (along <= 0 || across > along) continue;
    const score = along + across * 2;
    if (!best || score < best.score || (score === best.score && id < best.id)) best = { id, score };
  }
  return best?.id;
}

// ---------------------------------------------------------------------------
// Outline of a place made of several blocks
// ---------------------------------------------------------------------------

/**
 * One SVG path around the union of a place's blocks, so a route drawn as a row of 7×7 blocks
 * selects as a single rectangle (an L-shaped route as one L). Rects are split into `cell`-sized
 * cells, interior edges cancel, and the remaining edges are chained into closed loops with collinear
 * points dropped.
 */
export function unionOutline(rects: Rect[], cell = 7): string {
  type P = [number, number];
  const key = ([x, y]: P) => `${x},${y}`;
  // Directed edges, clockwise around each cell; a shared edge appears in both directions and cancels.
  const edges = new Map<string, P[]>();
  const cancel = new Set<string>();
  const add = (a: P, b: P) => {
    const back = `${key(b)}>${key(a)}`;
    if (cancel.has(back)) {
      cancel.delete(back);
      const list = edges.get(key(b))!;
      list.splice(list.findIndex((q) => key(q) === key(a)), 1);
      return;
    }
    cancel.add(`${key(a)}>${key(b)}`);
    (edges.get(key(a)) ?? edges.set(key(a), []).get(key(a))!).push(b);
  };
  for (const [x, y, w, h] of rects)
    for (let cx = 0; cx < Math.max(1, Math.round(w / cell)); cx++)
      for (let cy = 0; cy < Math.max(1, Math.round(h / cell)); cy++) {
        const x0 = x + cx * cell, y0 = y + cy * cell, x1 = x0 + Math.min(cell, w), y1 = y0 + Math.min(cell, h);
        add([x0, y0], [x1, y0]);
        add([x1, y0], [x1, y1]);
        add([x1, y1], [x0, y1]);
        add([x0, y1], [x0, y0]);
      }
  const parts: string[] = [];
  for (const [startKey, outs] of edges) {
    while (outs.length) {
      const start = startKey.split(',').map(Number) as P;
      const pts: P[] = [start];
      let cur: P = outs.shift()!;
      while (key(cur) !== startKey) {
        pts.push(cur);
        const next = edges.get(key(cur));
        if (!next?.length) break;
        cur = next.shift()!;
      }
      // drop points on straight runs
      const tidy = pts.filter((p, i) => {
        const a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length];
        return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]);
      });
      parts.push(`M${tidy.map((q) => q.join(' ')).join('L')}Z`);
    }
  }
  return parts.join('');
}
