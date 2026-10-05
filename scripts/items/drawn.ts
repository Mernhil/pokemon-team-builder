/**
 * Icons drawn in-process for items that have no official artwork anywhere we can fetch (the new Mega Stones
 * of Pokémon Champions, Fairy Feather, Generation 2's mails and berries, the Kanto badges…). Each kind has
 * its own look so an item is never the same grey gem as every other missing one; Mega Stones take the colour
 * of their Pokémon's type. These are stand-ins (clearly stylised, 28 px) until real art exists.
 */
export const TYPE_COLOR: Record<string, string> = {
  Normal: '#a8a77a', Fire: '#ee8130', Water: '#6390f0', Electric: '#f7d02c', Grass: '#7ac74c', Ice: '#96d9d6', Fighting: '#c22e28', Poison: '#a33ea1',
  Ground: '#e2bf65', Flying: '#a98ff3', Psychic: '#f95587', Bug: '#a6b91a', Rock: '#b6a136', Ghost: '#735797', Dragon: '#6f35fc', Dark: '#705746', Steel: '#b7b7ce', Fairy: '#d685ad',
};

const wrap = (inner: string) => `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
const shade = (hex: string, f: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v + (f > 0 ? (255 - v) * f : v * f))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, '0')).join('')}`;
};

/** A Mega Stone: a faceted gem in the type colour with the Mega Evolution sparkle (`z`: a gold rim for the Mega-Z stones). */
export const megaStone = (color: string, z = false) =>
  wrap(`<polygon points="14,2 24,10 20,25 8,25 4,10" fill="${color}" stroke="${shade(color, -0.45)}" stroke-width="1.3"/>
  <polygon points="14,2 24,10 14,14 4,10" fill="${shade(color, 0.45)}" stroke="${shade(color, -0.45)}" stroke-width="0.8"/>
  <polygon points="14,14 24,10 20,25" fill="${shade(color, -0.2)}"/><path d="M14 6l1.2 3 3 1.2-3 1.2L14 14.4l-1.2-3-3-1.2 3-1.2z" fill="#fff" opacity="0.9"/>
  ${z ? '<polygon points="14,2 24,10 20,25 8,25 4,10" fill="none" stroke="#f4c430" stroke-width="2"/>' : ''}`);

/** Fairy Feather: a soft pink feather. */
export const fairyFeather = () =>
  wrap(`<path d="M22 3C12 3 5 10 5 20c0 1.7.4 3.3 1 4.7C7.6 26 9 26 9 26c1-4 3-7 6-9.5-2 3-3 6-3 9.5C20 26 26 17 22 3z" fill="#f7b6d8" stroke="#c0568f" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="M6 25c3-7 8-12 15-17" fill="none" stroke="#c0568f" stroke-width="1.3" stroke-linecap="round"/><path d="M12 15l5 2M10 19l5 1.5M15 11l4 1.5" stroke="#e48ab8" stroke-width="1" stroke-linecap="round"/>`);

export const mail = (color: string) =>
  wrap(`<rect x="3" y="7" width="22" height="15" rx="2" fill="${shade(color, 0.55)}" stroke="${shade(color, -0.4)}" stroke-width="1.3"/><path d="M3.5 8.5L14 16l10.5-7.5" fill="none" stroke="${shade(color, -0.4)}" stroke-width="1.3" stroke-linejoin="round"/><circle cx="14" cy="16" r="2" fill="${color}"/>`);

export const badge = (color: string) =>
  wrap(`<circle cx="14" cy="14" r="10.5" fill="${color}" stroke="${shade(color, -0.5)}" stroke-width="1.5"/><circle cx="14" cy="14" r="6.5" fill="none" stroke="${shade(color, 0.6)}" stroke-width="1.4"/><path d="M14 8.5l1.6 3.5 3.8.4-2.9 2.5.9 3.7-3.4-2-3.4 2 .9-3.7-2.9-2.5 3.8-.4z" fill="${shade(color, 0.7)}"/>`);

export const berry = (color: string) =>
  wrap(`<path d="M14 9c-6 0-9 4-9 8.5C5 22 9 25 14 25s9-3 9-7.5C23 13 20 9 14 9z" fill="${color}" stroke="${shade(color, -0.45)}" stroke-width="1.3"/><path d="M14 9c0-3 1-5 4-6" fill="none" stroke="#4d7c2a" stroke-width="1.6" stroke-linecap="round"/><ellipse cx="10.5" cy="15" rx="2" ry="3" fill="#fff" opacity="0.35"/>`);

export const coin = () =>
  wrap(`<circle cx="14" cy="14" r="10.5" fill="#f4c430" stroke="#a87b00" stroke-width="1.5"/><circle cx="14" cy="14" r="7" fill="none" stroke="#a87b00" stroke-width="1.1"/><text x="14" y="18.2" font-size="11" font-weight="700" text-anchor="middle" fill="#a87b00" font-family="sans-serif">¢</text>`);

export const box = (color: string) =>
  wrap(`<rect x="4" y="10" width="20" height="14" rx="1.5" fill="${color}" stroke="${shade(color, -0.45)}" stroke-width="1.3"/><rect x="3" y="6" width="22" height="6" rx="1.5" fill="${shade(color, 0.3)}" stroke="${shade(color, -0.45)}" stroke-width="1.3"/><rect x="12" y="6" width="4" height="18" fill="${shade(color, -0.25)}"/>`);

export const ticket = (color: string) =>
  wrap(`<path d="M3 8h22v4a2 2 0 000 4v4H3v-4a2 2 0 000-4z" fill="${color}" stroke="${shade(color, -0.45)}" stroke-width="1.3" stroke-linejoin="round"/><path d="M10 9v10" stroke="${shade(color, -0.45)}" stroke-width="1.2" stroke-dasharray="1.6 1.6"/>`);

export const bow = (color: string, dots = false) =>
  wrap(`<path d="M14 14L4 7v14zM14 14l10-7v14z" fill="${color}" stroke="${shade(color, -0.45)}" stroke-width="1.3" stroke-linejoin="round"/><circle cx="14" cy="14" r="3" fill="${shade(color, -0.2)}" stroke="${shade(color, -0.45)}" stroke-width="1"/>${dots ? '<circle cx="8" cy="14" r="1.1" fill="#fff"/><circle cx="20" cy="14" r="1.1" fill="#fff"/><circle cx="8" cy="11" r="0.9" fill="#fff"/><circle cx="20" cy="17" r="0.9" fill="#fff"/>' : ''}`);

export const device = (color: string) =>
  wrap(`<rect x="6" y="3" width="16" height="22" rx="3" fill="${color}" stroke="${shade(color, -0.5)}" stroke-width="1.4"/><rect x="9" y="6" width="10" height="7" rx="1" fill="#cfe9f3" stroke="${shade(color, -0.5)}" stroke-width="1"/><circle cx="14" cy="18.5" r="2.4" fill="${shade(color, 0.5)}" stroke="${shade(color, -0.5)}" stroke-width="1"/>`);

export const orb = (color: string) =>
  wrap(`<circle cx="14" cy="14" r="10.5" fill="${color}" stroke="${shade(color, -0.5)}" stroke-width="1.5"/><ellipse cx="10.5" cy="10" rx="3.4" ry="2.4" fill="#fff" opacity="0.5"/>`);

export const brick = () =>
  wrap(`<rect x="3" y="9" width="22" height="11" rx="1" fill="#c8643c" stroke="#7a3a1f" stroke-width="1.3"/><path d="M3 14.5h22M10 9v5.5M18 14.5V20" stroke="#7a3a1f" stroke-width="1.1"/>`);

export const question = () =>
  wrap(`<rect x="4" y="4" width="20" height="20" rx="4" fill="#cfd3da" stroke="#7b818c" stroke-width="1.5"/><text x="14" y="20.5" font-size="16" font-weight="700" text-anchor="middle" fill="#5d636e" font-family="sans-serif">?</text>`);
