#!/usr/bin/env node
// Renders the app-wide studio-spotlight backdrop (AppBackdrop) for both
// themes from ONE procedural scene, so dark and light are the same physical
// set under two lighting states — identical lamp, beam, falloff and floor
// reflection, pixel for pixel. Only the tone mapping differs per theme.
//
// Why procedural instead of a photo: the scene is pure light falloff, so it
// can be rendered natively at any resolution (never upscaled), computed in
// floating-point linear light, and dithered once on the way to 8-bit so the
// long, dark gradients don't band.
//
// Why lossless WebP: the scene's gradients are so shallow (in the dark theme
// one 8-bit step spans ~30px at 4K) that the ordered dither IS the image
// quality. Every lossy encoder tested (WebP q98, AVIF q90–96) smooths the
// dither away and brings 1-LSB contour bands back (200–300px flat runs);
// lossless AVIF is ~8× larger than lossless WebP; 10-bit AVIF needs a custom
// libvips. Lossless WebP of a 4×4-Bayer-dithered render is the smallest
// banding-free option (~330KB dark / ~250KB light at 3840×2160).
//
// Geometry is expressed in units of image HEIGHT, centred horizontally
// (u = horizontal offset from centre, v = distance from the top), and every
// light term fades to exactly zero before |u| = EDGE_U. The image edges are
// therefore a flat, known colour (THEMES[*].base), which AppBackdrop uses as
// the fill colour beyond the image on ultrawide viewports — the image is
// sized to the viewport height and never needs to be stretched or cropped
// vertically, so the lamp and the floor reflection are always in frame.
//
//   node scripts/generate-backdrop.mjs            # web renditions → public/backdrop/
//   node scripts/generate-backdrop.mjs --master   # also a 16-bit 7680×4320 PNG master per theme → assets/backdrop-source/
//                                                 # (~90MB each, gitignored — the script itself is the real master)
//
// Re-run after changing any constant below; keep BASE colours in sync with
// the `FILL` colours in src/components/layout/app-backdrop.tsx (the script
// prints them), and RENDITIONS in sync with `HEIGHTS` there.

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

const ROOT = resolve(import.meta.dirname, "..");
const OUT_DIR = resolve(ROOT, "public/backdrop");
const MASTER_DIR = resolve(ROOT, "assets/backdrop-source");

// Web renditions (height in px; width is 16:9). Heights, not widths, are what
// matter: the backdrop is always drawn at 100% of the viewport height. Steps
// are ≤1.33× apart so the browser never downsamples by much — heavy
// resampling averages the dither away and would reintroduce banding.
const RENDITIONS = [768, 900, 1080, 1440, 1800, 2160, 2880];
const MASTER_HEIGHT = 4320; // 7680×4320 (8K) master
const ASPECT = 16 / 9;
const EDGE_U = (ASPECT / 2) * 0.96; // all light has faded out by here

// ── Scene (shared by both themes) ───────────────────────────────────────────
const LAMP = { v: 0.045, rx: 0.1, ry: 0.0078 }; // overhead light slot
const POOL = { v: 0.34, rx: 0.36, ry: 0.3 }; // main soft pool of light
const FLOOR = { v: 0.862, rx: 0.36, ry: 0.036 }; // reflection on the floor

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// C²-smooth step: no visible "shoulder" (Mach band) where a falloff starts or ends.
const smootherstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const gauss = (x) => Math.exp(-x * x);

/** Light contributions at (u, v): lamp (0..1), glow (≈0..1), floor (≈0..1). */
function scene(u, v) {
  const au = Math.abs(u);
  // Horizontal window: a long, gentle roll-off that guarantees an exactly flat
  // colour at the image edges (the fill colour beyond them on ultrawides).
  const win = 1 - smootherstep(EDGE_U * 0.2, EDGE_U, au);

  // Lamp: a crisp, anti-aliased ellipse plus a tight bloom and a short, faint
  // flare along the ceiling line (fades well before the edges).
  const dl = Math.hypot(u / LAMP.rx, (v - LAMP.v) / LAMP.ry);
  const core = 1 - smoothstep(0.8, 1.0, dl);
  const bloom = gauss(Math.hypot(u / 0.16, (v - LAMP.v) / 0.022)) * 0.4;
  const flare = gauss((v - LAMP.v) / 0.006) * gauss(u / 0.26) * 0.05;
  const lamp = Math.min(1, core + bloom + flare);

  // Beam: widens with depth below the lamp and fades as it travels — a soft
  // cone, Gaussian across so it has no edge, eased in at the lamp.
  const t = Math.max(0, v - LAMP.v);
  const hw = 0.09 + 0.5 * t;
  const cone = gauss(u / hw) * Math.exp(-t / 0.4) * smootherstep(0, 0.06, t);

  // Pool: large, soft light falling on the back wall (a plain Gaussian, so
  // its gradient is continuous everywhere).
  const pool = gauss(Math.hypot(u / POOL.rx, (v - POOL.v) / POOL.ry));

  const glow = (0.6 * cone + 0.55 * pool) * win;

  // Floor: a restrained reflection and a broader, fainter wash around it.
  const refl = gauss(Math.hypot(u / FLOOR.rx, (v - FLOOR.v) / FLOOR.ry));
  const wash = gauss(Math.hypot(u / 0.62, (v - FLOOR.v) / 0.1)) * 0.45;
  const floor = (refl * 0.7 + wash) * win;

  return [lamp * win, glow, floor];
}

// ── Themes: tone mapping only (linear-light RGB) ────────────────────────────
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const lin = (r, g, b) => [r, g, b].map((x) => srgbToLinear(x / 255));

const THEMES = {
  dark: {
    base: [9, 9, 11], // matte near-black studio
    glow: lin(54, 55, 58), // pool peak colour ADDED over the base
    floor: lin(28, 28, 30),
    lamp: lin(250, 251, 255),
  },
  light: {
    base: [206, 208, 212], // cool off-white/light-grey studio
    glow: lin(158, 158, 157),
    floor: lin(112, 112, 112),
    lamp: lin(255, 255, 255),
  },
};

// 4×4 Bayer matrix, normalised to (-0.5, 0.5): an ordered ±½-LSB dither. 16
// coverage levels (1/16 of an 8-bit step) is far below what's visible, and the
// short period compresses ~30% better losslessly than an 8×8 matrix.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((n) => (n + 0.5) / 16 - 0.5);

export function render(theme, height, { bits = 8 } = {}) {
  const width = Math.round(height * ASPECT);
  const { base, glow, floor, lamp } = THEMES[theme];
  const baseLin = lin(...base);
  const max = bits === 16 ? 65535 : 255;
  const out = bits === 16 ? new Uint16Array(width * height * 3) : new Uint8Array(width * height * 3);

  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5 - width / 2) / height;
      const [l, g, f] = scene(u, v);
      const i = (y * width + x) * 3;
      const d = bits === 16 ? 0 : BAYER[(y & 3) * 4 + (x & 3)];
      for (let c = 0; c < 3; c++) {
        let val = baseLin[c] + g * glow[c] + f * floor[c];
        val = val + (lamp[c] - val) * l; // the lamp itself is opaque light
        const s = linearToSrgb(Math.min(1, Math.max(0, val)));
        out[i + c] = Math.min(max, Math.max(0, Math.round(s * max + d)));
      }
    }
  }
  return { data: out, width, height };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const withMaster = process.argv.includes("--master");

  for (const theme of Object.keys(THEMES)) {
    for (const h of RENDITIONS) {
      const { data, width, height } = render(theme, h);
      const name = `spotlight-${theme}-${h}.webp`;
      const { size } = await sharp(data, { raw: { width, height, channels: 3 } })
        .webp({ lossless: true, quality: 100, effort: 6 })
        .toFile(`${OUT_DIR}/${name}`);
      console.log(`${name}  ${width}×${height}  ${(size / 1024).toFixed(0)}KB`);
    }
    if (withMaster) {
      mkdirSync(MASTER_DIR, { recursive: true });
      const { data, width, height } = render(theme, MASTER_HEIGHT, { bits: 16 });
      await sharp(data, { raw: { width, height, channels: 3 } })
        .toColourspace("rgb16")
        .png({ compressionLevel: 9 })
        .toFile(`${MASTER_DIR}/spotlight-${theme}-master.png`);
      console.log(`master spotlight-${theme}-master.png  ${width}×${height} 16-bit`);
    }
    console.log(`  --backdrop-fill (${theme}): rgb(${THEMES[theme].base.join(" ")})`);
  }
}

if (process.argv[1] === import.meta.filename) await main();
