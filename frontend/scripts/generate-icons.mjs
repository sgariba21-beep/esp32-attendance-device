/**
 * Rasterise the PWA icon set from the SVG sources in public/icons/.
 *
 * One-off / on-demand: the generated PNGs are committed, so CI and Vercel never
 * run this. Re-run it (`npm run gen:icons`) only after editing a source SVG.
 *
 * Uses `sharp`, which is already present as an optional dependency of Next.js —
 * no extra package to install.
 */
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ICONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

/** [source svg, output png, pixel size] */
const TARGETS = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon-maskable.svg', 'icon-maskable-192.png', 192],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
  ['apple-icon.svg', 'apple-icon-180.png', 180],
]

for (const [src, out, size] of TARGETS) {
  // High render density then downscale = crisp edges at every size.
  await sharp(join(ICONS_DIR, src), { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(join(ICONS_DIR, out))
  console.log(`  ${out}  (${size}x${size})`)
}

console.log('PWA icons written to public/icons/')
