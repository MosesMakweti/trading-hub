// Studio-spotlight backdrop — a non-interactive decorative layer behind the
// whole app (fixed, -z-10, pointer-events-none, aria-hidden).
//
// Both themes are the SAME procedural scene (scripts/generate-backdrop.mjs):
// identical lamp, beam, falloff and floor reflection, pixel for pixel — only
// the tone mapping differs. So a theme switch is a plain opacity crossfade of
// the dark layer over the light one, and reads as the room's lighting
// changing rather than one picture being swapped for another.
//
// Sizing: the image is always exactly the viewport's height (top-anchored,
// horizontally centred, natural 16:9 width) — never `object-cover`, which
// would scale it up on ultrawides and crop the floor reflection. Narrower
// viewports (laptops, mobile) crop the sides; wider ones (21:9, 32:9) show
// the layer's `FILL` colour beyond the image, which is exactly the image's
// own edge colour (the generator fades every light term to zero before the
// edge), so there's no seam. `sizes` is therefore in `vh`, and the browser
// picks a rendition at (or just above) the real device-pixel height — a
// native-resolution image, never an upscaled one.
//
// Plain <img srcset>, not next/image: the files are lossless WebP whose
// ordered dither is what keeps the long gradients from banding; the image
// optimizer's lossy re-encode would strip it, and its width-based
// `deviceSizes` can't express "as tall as the viewport".

/** Rendition heights, in sync with RENDITIONS in scripts/generate-backdrop.mjs. */
const HEIGHTS = [768, 900, 1080, 1440, 1800, 2160, 2880];
/** Each theme's flat edge colour (the generator prints these). */
const FILL = { light: "rgb(206 208 212)", dark: "rgb(9 9 11)" } as const;

type Theme = keyof typeof FILL;

const srcSet = (theme: Theme) =>
  HEIGHTS.map((h) => `/backdrop/spotlight-${theme}-${h}.webp ${Math.round((h * 16) / 9)}w`).join(", ");

function Layer({ theme, className = "" }: { theme: Theme; className?: string }) {
  return (
    <div className={`absolute inset-0 ${className}`} style={{ backgroundColor: FILL[theme] }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- see header: next/image would re-encode lossily */}
      <img
        src={`/backdrop/spotlight-${theme}-2160.webp`}
        srcSet={srcSet(theme)}
        sizes="177.78vh"
        alt=""
        decoding="async"
        draggable={false}
        className="absolute top-0 left-1/2 h-lvh w-auto max-w-none -translate-x-1/2 select-none"
      />
    </div>
  );
}

export function AppBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <Layer theme="light" />
      <Layer
        theme="dark"
        className="opacity-0 transition-opacity duration-500 ease-in-out motion-reduce:transition-none dark:opacity-100"
      />
    </div>
  );
}
