/**
 * Map skins: how a game's map looks and highlights, the map-side counterpart of the sprite sets.
 * Versions that share a region (DPPt, HGSS, BW/B2W2) share a skin and differ only in data.
 * The game's own artwork is rendered by `npm run maps`; a skin says how it is presented
 * (integer upscale, cursor and highlight style), so every game's map reads like that game's.
 */
export interface MapSkin {
  id: string;
  label: string;
  /** Native resolution of the rendered map image, for integer upscaling. */
  resolution: [number, number];
  palette: {
    /** Outline of the selected / pinned location. */
    cursor: string;
    /** Soft glow on locations matching a filter or search. */
    match: string;
    /** Locations marked done in the progress tracker. */
    done: string;
    /** Dimming colour laid over non-matching locations while a filter is active. */
    dim: string;
    /** Keyboard focus ring. */
    focus: string;
  };
  /** The game's cursor: a square frame (Platinum Town Map), a pointing hand, or a filled marker. */
  cursor: 'frame' | 'marker';
  /** Pixel map: always upscale by whole numbers. */
  pixelPerfect: boolean;
  /** Stylized recreation of a 3D / open-world region (label shown under the map). */
  stylized?: boolean;
}

export const MAP_SKINS: Record<string, MapSkin> = {
  dppt: {
    id: 'dppt',
    label: 'Sinnoh Town Map',
    resolution: [216, 168],
    palette: { cursor: '#ffffff', match: '#ffe066', done: '#57d26b', dim: '#0b1a3acc', focus: '#ffffff' },
    cursor: 'frame',
    pixelPerfect: true,
  },
};

export const skinFor = (id: string): MapSkin => MAP_SKINS[id] ?? MAP_SKINS.dppt;
