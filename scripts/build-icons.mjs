/**
 * Renders the PWA / home-screen icons in public/icons/ from src-assets/logo-source.png — the app's
 * icon artwork (a rounded square, background baked in, no wordmark). Run with `npm run icons` after
 * replacing that source image. Desktop (Tauri) icons are regenerated separately, from the same
 * source, via `npx tauri icon src-assets/logo-source.png`.
 */
import sharp from 'sharp';

const logo = 'src-assets/logo-source.png';

async function icon(size, out) {
  await sharp(logo).resize(size, size, { fit: 'cover' }).png().toFile(out);
  console.log('wrote', out);
}

await icon(180, 'public/icons/apple-touch-icon.png');
await icon(192, 'public/icons/icon-192.png');
await icon(512, 'public/icons/icon-512.png');
// The source's content already sits well inside a circular safe zone, so the maskable icon can
// reuse the same full-bleed render rather than a separately padded composite.
await icon(512, 'public/icons/maskable-512.png');
await icon(32, 'public/favicon.png');
