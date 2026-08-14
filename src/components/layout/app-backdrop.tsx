// Photo backdrop — a non-interactive decorative layer behind the whole app
// (fixed, -z-10, pointer-events-none, aria-hidden): a dedicated monochrome
// candlestick-market image per theme (dark image in dark mode, light image in
// light mode — genuinely different artwork, not one image color-adjusted),
// softened with a slow drift, a top fade (keeps the header band clean), an
// atmospheric top bloom, and a vignette — so foreground glass cards always read
// clearly over it. Both images render at all times; only the theme's `dark:`
// class variant decides which is visible (same trick as `ThemeToggle`'s two
// icons), so there's no client/server hydration mismatch. The only motion is a
// very slow GPU drift, disabled under reduced-motion.

import Image from "next/image";

export function AppBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="backdrop-drift-a absolute inset-0" style={{ opacity: "var(--backdrop-strength)" }}>
        <Image
          src="/backdrop/market-light.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover dark:hidden"
        />
        <Image
          src="/backdrop/market-dark.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="hidden object-cover dark:block"
        />
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
