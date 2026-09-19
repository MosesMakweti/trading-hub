// Photo backdrop — a non-interactive decorative layer behind the whole app
// (fixed, -z-10, pointer-events-none, aria-hidden): a dedicated monochrome
// low-poly "trading bull" network artwork per theme (dark render in dark
// mode, light render in light mode), softened with a slow drift, a top fade
// (keeps the header band clean), an atmospheric top bloom, and a vignette —
// so foreground `.glass` cards (opaque; see design-system.md §7) always read
// clearly over it. The bull is built from interconnected wireframe polygons,
// nodes, and translucent facets — dark: black/charcoal facets with
// silver/white structural lines; light: independently balanced white/silver
// facets with graphite lines (not an inverted copy). 3840x2160 WebP each,
// Lanczos-upscaled from a 1659x948 source + unsharp-masked (untouched
// masters live outside /public, at assets/backdrop-source/, so they're never
// part of the deployed static bundle). Both stay crisp at
// full-viewport `object-cover` sizes on 4K/5K displays. `object-position` is
// fixed at 88% 12% (near the head/horns, close to the top) rather than
// centered: cover-fit only ever crops ONE axis at a time (whichever the
// viewport overflows relative to the image's native 16:9), so a single
// off-center anchor correctly protects the head/horns/back-ridge silhouette
// on both extremes — narrow/tall viewports (mobile) crop horizontally and
// keep the anchor's right bias; wide/short viewports (ultrawide) crop
// vertically and keep the anchor's top bias — without needing responsive
// breakpoints. A second, blurred copy of the same image is masked to a soft
// ring around the edges (radial mask keeps the centre untouched), giving a
// mild depth-of-field effect rather than blurring the whole scene. Both
// images render at all times; only the theme's `dark:` class variant decides
// which is visible (same trick as `ThemeToggle`'s two icons), so there's no
// client/server hydration mismatch and no wrong-theme flash. The only motion
// is a very slow GPU drift, disabled under reduced-motion.

import Image from "next/image";

const OBJECT_POSITION = "object-[88%_12%]";

export function AppBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="backdrop-drift-a absolute inset-0" style={{ opacity: "var(--backdrop-strength)" }}>
        <Image
          src="/backdrop/bull-light.webp"
          alt=""
          fill
          priority
          quality={90}
          sizes="100vw"
          className={`object-cover ${OBJECT_POSITION} dark:hidden`}
        />
        <Image
          src="/backdrop/bull-dark.webp"
          alt=""
          fill
          priority
          quality={90}
          sizes="100vw"
          className={`hidden object-cover ${OBJECT_POSITION} dark:block`}
        />

        {/* Depth-of-field ring: same art, blurred, masked to the edges only. */}
        <div
          className="absolute inset-0"
          style={{
            maskImage: "radial-gradient(ellipse 62% 58% at 50% 42%, transparent 55%, black 100%)",
            WebkitMaskImage: "radial-gradient(ellipse 62% 58% at 50% 42%, transparent 55%, black 100%)",
          }}
        >
          <Image
            src="/backdrop/bull-light.webp"
            alt=""
            fill
            sizes="100vw"
            className={`object-cover ${OBJECT_POSITION} blur-2xl dark:hidden`}
          />
          <Image
            src="/backdrop/bull-dark.webp"
            alt=""
            fill
            sizes="100vw"
            className={`hidden object-cover ${OBJECT_POSITION} blur-2xl dark:block`}
          />
        </div>
      </div>

      {/* Keep the header band clean: fade the canvas colour over the top. */}
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(to bottom, var(--background) 1%, transparent 22%)" }}
      />
      {/* Atmospheric top bloom. */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse 90% 55% at 50% 8%, var(--backdrop-glow), transparent 60%)" }}
      />
      {/* Vignette — fade the edges so the image feels integrated, not pasted on. */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse 135% 130% at 50% 46%, transparent 46%, var(--backdrop-vignette) 100%)" }}
      />
    </div>
  );
}
