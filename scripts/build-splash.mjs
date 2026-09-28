/**
 * iOS launch screens ("apple-touch-startup-image") for the home-screen app: the logo centred on
 * the dark theme background, one PNG per iPhone screen size, portrait. Writes public/splash/*.png
 * and prints the <link> tags that index.html carries. Run `npm run splash` after changing the logo.
 *
 * iOS only shows a launch image whose size and pixel ratio match the device exactly; sizes not in
 * this list simply show the background colour while the app starts, which is harmless.
 */
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const logo = 'src-assets/logo-source.png';
/** The dark theme's page background (src/index.css .dark --color-bg). */
const BG = '#15171d';

/** CSS width × height (points) and pixel ratio of each iPhone screen generation. */
export const SCREENS = [
  { w: 440, h: 956, dpr: 3, devices: 'iPhone 16 Pro Max' },
  { w: 402, h: 874, dpr: 3, devices: 'iPhone 16 Pro' },
  { w: 430, h: 932, dpr: 3, devices: 'iPhone 14 Pro Max, 15 Plus/Pro Max, 16 Plus' },
  { w: 393, h: 852, dpr: 3, devices: 'iPhone 14 Pro, 15, 15 Pro, 16' },
  { w: 428, h: 926, dpr: 3, devices: 'iPhone 12/13 Pro Max, 14 Plus' },
  { w: 390, h: 844, dpr: 3, devices: 'iPhone 12, 12 Pro, 13, 13 Pro, 14' },
  { w: 375, h: 812, dpr: 3, devices: 'iPhone X, XS, 11 Pro, 12 mini, 13 mini' },
  { w: 414, h: 896, dpr: 3, devices: 'iPhone XS Max, 11 Pro Max' },
  { w: 414, h: 896, dpr: 2, devices: 'iPhone XR, 11' },
  { w: 414, h: 736, dpr: 3, devices: 'iPhone 6/7/8 Plus' },
  { w: 375, h: 667, dpr: 2, devices: 'iPhone 6/7/8, SE (2nd/3rd gen)' },
  { w: 320, h: 568, dpr: 2, devices: 'iPhone SE (1st gen)' },
];

mkdirSync('public/splash', { recursive: true });
const links = [];
for (const s of SCREENS) {
  const width = s.w * s.dpr;
  const height = s.h * s.dpr;
  const size = Math.round(width * 0.36);
  const mark = await sharp(logo).resize(size, size).png().toBuffer();
  const file = `splash/launch-${width}x${height}.png`;
  await sharp({ create: { width, height, channels: 3, background: BG } })
    .composite([{ input: mark, gravity: 'center' }])
    .png({ compressionLevel: 9, palette: true })
    .toFile(`public/${file}`);
  links.push(
    `    <link rel="apple-touch-startup-image" href="/${file}" media="(device-width: ${s.w}px) and (device-height: ${s.h}px) and (-webkit-device-pixel-ratio: ${s.dpr}) and (orientation: portrait)" />`,
  );
  console.log('wrote', file, `(${s.devices})`);
}
console.log('\n' + links.join('\n'));
