// Android launcher icons + splash screens from public/icon.svg (the PWA icon),
// so the app and the PWA share one source. Run after changing the icon:
//   npm run android:icons
// Writes into android/app/src/main/res: legacy + round launcher icons, the
// adaptive-icon foreground (glyph only, inside the 66 dp safe zone, on the
// ic_launcher_background colour) and every splash.png at its existing size.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const RES = join(ROOT, 'android/app/src/main/res');
const BACKGROUND = '#12141a';

const icon = readFileSync(join(ROOT, 'public/icon.svg'), 'utf8');
// The glyph alone: the full icon minus its rounded background tile.
const glyph = icon.replace(/<rect[^>]*\/>\s*/, '');
/** The glyph's outer arcs span ~402 of the 512-unit viewBox. */
const GLYPH_SPAN = 402 / 512;

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const png = (svg, size) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png();

async function glyphOn(width, height, glyphPx, background) {
  const mark = await png(glyph, Math.round(glyphPx)).toBuffer();
  const base = sharp({
    create: { width, height, channels: 4, background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } },
  });
  return base.composite([{ input: mark, gravity: 'center' }]).png().toBuffer();
}

for (const [name, scale] of Object.entries(DENSITIES)) {
  const dir = join(RES, `mipmap-${name}`);
  const legacy = Math.round(48 * scale);
  await png(icon, legacy).toFile(join(dir, 'ic_launcher.png'));
  // Round: the glyph on a dark disc.
  const disc = `<svg xmlns="http://www.w3.org/2000/svg" width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}" fill="${BACKGROUND}"/></svg>`;
  const roundMark = await png(glyph, Math.round(legacy * 0.92)).toBuffer();
  await sharp(Buffer.from(disc))
    .composite([{ input: roundMark, gravity: 'center' }])
    .png()
    .toFile(join(dir, 'ic_launcher_round.png'));
  // Adaptive foreground: 108 dp canvas; keep the glyph's arcs within ~64 dp.
  const fg = Math.round(108 * scale);
  writeFileSync(
    join(dir, 'ic_launcher_foreground.png'),
    await glyphOn(fg, fg, (64 * scale) / GLYPH_SPAN),
  );
}

writeFileSync(
  join(RES, 'values/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BACKGROUND}</color>\n</resources>\n`,
);

const hex = BACKGROUND.slice(1);
const bg = {
  r: parseInt(hex.slice(0, 2), 16),
  g: parseInt(hex.slice(2, 4), 16),
  b: parseInt(hex.slice(4, 6), 16),
  alpha: 1,
};
for (const dir of readdirSync(RES).filter((d) => d.startsWith('drawable'))) {
  const file = join(RES, dir, 'splash.png');
  let meta;
  try {
    meta = await sharp(file).metadata();
  } catch {
    continue;
  }
  const { width, height } = meta;
  writeFileSync(file, await glyphOn(width, height, Math.min(width, height) * 0.3, bg));
}

console.log('Android icons and splash screens written to', RES);
