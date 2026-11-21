"use client";

import { cn } from "@/lib/utils";
import type { EnvironmentId } from "@/domain/mindset/options";
import { ENV_THEME } from "@/components/mindset/environment-backdrop";

const FADE_IN_MS = 1400;
const FADE_OUT_MS = 1200;

/**
 * One mantra, large and centred. The fade is derived from how long this
 * mantra has been on screen (`slideMs`), so it pauses with the session and a
 * manual change starts a fresh, gentle fade-in.
 */
export function MantraSlideshow({
  text,
  category,
  slideKey,
  slideMs,
  slideDurationMs,
  position,
  total,
  environment,
}: {
  text: string;
  category: string | null;
  slideKey: string;
  slideMs: number;
  slideDurationMs: number;
  position: number;
  total: number;
  environment: EnvironmentId;
}) {
  const theme = ENV_THEME[environment];
  const fadeIn = Math.min(1, slideMs / FADE_IN_MS);
  const fadeOut = Math.min(1, Math.max(0, (slideDurationMs - slideMs) / FADE_OUT_MS));
  const opacity = Math.min(fadeIn, fadeOut);
  const long = text.length > 90;

  return (
    <figure className="flex w-full max-w-4xl flex-col items-center gap-8 px-6 text-center">
      <blockquote
        key={slideKey}
        className={cn("font-serif leading-snug tracking-wide text-balance transition-opacity duration-200 ease-linear", long ? "text-3xl sm:text-4xl" : "text-4xl sm:text-5xl lg:text-6xl", theme.text)}
        style={{ opacity, textShadow: "0 2px 30px rgba(0,0,0,0.45)" }}
        aria-live="polite"
      >
        {text}
      </blockquote>
      <figcaption className={cn("text-xs tracking-[0.25em] uppercase transition-opacity duration-200", theme.muted)} style={{ opacity: opacity * 0.9 }}>
        {category ? `${category} · ` : ""}
        {position + 1} of {total}
      </figcaption>
    </figure>
  );
}
