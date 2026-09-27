/**
 * Renders the PWA / home-screen icons in public/icons/ from src-assets/logo-source.png — the app's
 * icon artwork (transparent background, symbol only, no wordmark). Run with `npm run icons` after
 * replacing that source image. Desktop (Tauri) icons are regenerated separately, from the same
 * source, via `npx tauri icon src-assets/logo-source.png`.
 */
import sharp from 'sharp';

const logo = 'src-assets/logo-source.png';
// Matches the manifest's theme_color/background_color (vite.config.ts) — used only where an
// opaque backing is technically required, never to reintroduce a plain white card behind the mark.
const THEME_BG = '#0e1117';

async function icon(size, out, { opaque = false } = {}) {
  let pipeline = sharp(logo).resize(size, size, { fit: 'cover' });
  if (opaque) pipeline = pipeline.flatten({ background: THEME_BG });
  await pipeline.png().toFile(out);
  console.log('wrote', out);
}

// iOS doesn't composite transparency on home-screen icons (it fills alpha with black), so give
// apple-touch-icon an opaque backing. Standard "any"-purpose manifest icons and the favicon are
// fine transparent in every modern browser/OS.
await icon(180, 'public/icons/apple-touch-icon.png', { opaque: true });
await icon(192, 'public/icons/icon-192.png');
await icon(512, 'public/icons/icon-512.png');
// Maskable icons are cropped to a system-defined shape (circle, squircle, …) with no transparency
// support — the source's padding already keeps the mark inside the safe zone, so this only needs
// an opaque backing, not a separate composite.
await icon(512, 'public/icons/maskable-512.png', { opaque: true });
await icon(32, 'public/favicon.png');
