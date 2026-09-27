/**
 * Renders the PWA / home-screen icons in public/icons/ from public/favicon.svg.
 * iOS ignores transparency on home-screen icons (it fills it with black), so every icon gets
 * the app's dark background; the maskable one keeps the logo inside the 80% safe zone.
 * Run with `npm run icons` after changing the favicon.
 */
import sharp from 'sharp';

const BG = '#0e1117';
const logo = 'public/favicon.svg';

async function icon(size, scale, out) {
  const inner = Math.round(size * scale);
  const glyph = await sharp(logo, { density: 1200 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: glyph, gravity: 'center' }])
    .png()
    .toFile(out);
  console.log('wrote', out);
}

await icon(180, 0.7, 'public/icons/apple-touch-icon.png');
await icon(192, 0.7, 'public/icons/icon-192.png');
await icon(512, 0.7, 'public/icons/icon-512.png');
await icon(512, 0.55, 'public/icons/maskable-512.png');
