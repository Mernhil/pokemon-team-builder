import { describe, expect, it } from 'vitest';
import mapsJson from '@/data/generated/maps.json';
import { IDENTITY_VIEW, MAX_ZOOM, centerOn, clampView, placeCenter, resolveLocations, zoomAt, type MapPlaces } from '@/domain/regionMaps';

const maps = mapsJson as unknown as { maps: Record<string, MapPlaces & { image?: string; source: string }>; games: Record<string, string[]> };
const gameMaps = (game: string) => maps.games[game].map((id) => maps.maps[id]);

describe('location resolution', () => {
  it('opens the map that shows most of the locations and lists the rest as off-map', () => {
    const r = resolveLocations(gameMaps('firered'), ['four-island', 'five-island', 'kanto-route-1', 'roaming-kanto']);
    expect(r.best?.id).toBe('sevii-45');
    expect(r.hits.get('kanto-frlg')).toEqual(['kanto-route-1']);
    expect(r.offMap).toEqual(['roaming-kanto']);
  });

  it('places Sinnoh from the Platinum Town Map for Diamond/Pearl, Platinum and BDSP', () => {
    for (const game of ['diamond', 'platinum', 'brilliant-diamond']) expect(maps.games[game]).toEqual(['sinnoh-pt']);
    const sinnoh = maps.maps['sinnoh-pt'];
    expect(sinnoh.source).toBe('pret/pokeplatinum');
    expect(sinnoh.image).toBe('maps/sinnoh-pt.webp');
    // Routes span several 7×7 blocks; the lakes resolve from their caverns, Trophy Garden from the Pokémon Mansion.
    expect(sinnoh.places['sinnoh-route-201'].length).toBeGreaterThan(1);
    for (const loc of ['lake-verity', 'lake-valor', 'lake-acuity', 'trophy-garden', 'eterna-city', 'mt-coronet', 'sendoff-spring', 'stark-mountain'])
      expect(sinnoh.places[loc], loc).toBeDefined();
    // BDSP's Grand Underground runs under the whole region: listed, never pinned somewhere arbitrary.
    expect(resolveLocations([sinnoh], ['sinnoh-grand-underground']).offMap).toEqual(['sinnoh-grand-underground']);
  });

  it('keeps the real maps real: every in-game map has an image; schematics have none', () => {
    for (const m of Object.values(maps.maps)) expect(Boolean(m.image), m.id).toBe(m.source !== 'schematic');
  });

  it('centres a place on its first rectangle', () => {
    expect(placeCenter([[10, 20, 8, 6], [0, 0, 1, 1]])).toEqual([14, 23]);
  });
});

describe('map viewer zoom and pan', () => {
  const W = 300, H = 200;

  it('zooms about the pointer and never shows empty margins', () => {
    const v = zoomAt(IDENTITY_VIEW, 2, 150, 100, W, H);
    expect(v).toEqual({ scale: 2, x: -150, y: -100 });
    // A corner zoom stays anchored at the corner.
    expect(zoomAt(IDENTITY_VIEW, 2, 0, 0, W, H)).toEqual({ scale: 2, x: 0, y: 0 });
    // Panning past the edge is clamped.
    expect(clampView({ scale: 2, x: 50, y: -500 }, W, H)).toEqual({ scale: 2, x: 0, y: -200 });
  });

  it('stays within the zoom limits and returns to the whole map at 1×', () => {
    expect(zoomAt(IDENTITY_VIEW, 100, 0, 0, W, H).scale).toBe(MAX_ZOOM);
    expect(zoomAt({ scale: 3, x: -100, y: -80 }, 0.1, 0, 0, W, H)).toEqual(IDENTITY_VIEW);
  });

  it('centres on a location when zoomed', () => {
    expect(centerOn({ scale: 2, x: 0, y: 0 }, 0.5, 0.5, W, H)).toEqual({ scale: 2, x: -150, y: -100 });
    expect(centerOn({ scale: 2, x: 0, y: 0 }, 1, 1, W, H)).toEqual({ scale: 2, x: -300, y: -200 });
  });
});
