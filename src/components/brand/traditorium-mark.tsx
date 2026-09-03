import type { SVGProps } from "react";

/**
 * Traditorium brand mark — a "T" beam spanning a single candlestick: one roof
 * over the whole of a trader's operation (the "-orium", a place where the parts
 * come together), with the trade itself standing under it. Monochrome and
 * geometric, drawn on lucide's 24×24 grid at a matching stroke weight so it sits
 * cleanly beside the nav icons, and legible down to favicon size. Inherits
 * `currentColor`.
 */
export function TraditoriumMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      {...props}
    >
      {/* The beam — one roof across everything */}
      <path d="M3.5 5.5h17" strokeWidth={2.3} />
      {/* Candlestick wick, dropping from the beam */}
      <path d="M12 5.5v14" />
      {/* Candlestick body — the one solid mass, so the mark holds at favicon size */}
      <rect x="9" y="8.8" width="6" height="7.4" rx="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
