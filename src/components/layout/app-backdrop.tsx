// Floating candlestick backdrop — a non-interactive decorative layer that sits
// behind the entire app (fixed, -z-10, pointer-events-none, aria-hidden). Three
// depth planes of large, sparse, organically-placed candles are heavily blurred and
// kept at extremely low opacity, so the market reads as atmosphere floating behind
// the workspace — never a chart, never competing with content. Foreground glass
// cards (translucent) naturally soften the candles beneath them.
//
// Pure SVG + CSS (a few KB, no image download). Candle geometry is generated
// deterministically (seeded) so server and client render identically, and colors
// come from tokens (`--candle`) so it flips with the theme. The only motion is a
// very slow GPU drift, disabled under prefers-reduced-motion.

const W = 1600;
const H = 900;

interface Candle {
  x: number;
  w: number;
  bodyY: number;
  bodyH: number;
  wickTop: number;
  wickBot: number;
}

/** Deterministic PRNG (mulberry32) — stable output for a given seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A sparse row of candles following a gently rising, noisy baseline (like the
 *  reference's up-drifting market), with organic variation in size/position. */
function makeCandles(seed: number, count: number, scale: number): Candle[] {
  const r = rng(seed);
  const out: Candle[] = [];
  const gap = W / count;
  let baseline = H * 0.6;
  for (let i = 0; i < count; i += 1) {
    baseline += (r() - 0.42) * H * 0.08; // slight upward bias
    baseline = Math.max(H * 0.24, Math.min(H * 0.76, baseline));
    const w = (18 + r() * 30) * scale;
    const bodyH = (48 + r() * 165) * scale;
    const bodyY = baseline - bodyH / 2;
    const wickUp = (24 + r() * 70) * scale;
    const wickDn = (24 + r() * 70) * scale;
    const x = i * gap + (gap - w) / 2 + (r() - 0.5) * gap * 0.35;
    out.push({ x, w, bodyY, bodyH, wickTop: bodyY - wickUp, wickBot: bodyY + bodyH + wickDn });
  }
  return out;
}

function CandleLayer({ seed, count, scale }: { seed: number; count: number; scale: number }) {
  const candles = makeCandles(seed, count, scale);
  const gid = `cbody-${seed}`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
    >
      <defs>
        {/* Vertical light→dark fill gives each candle a subtle dimensional read. */}
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--candle)" stopOpacity="0.95" />
          <stop offset="55%" stopColor="var(--candle)" stopOpacity="0.72" />
          <stop offset="100%" stopColor="var(--candle)" stopOpacity="0.5" />
        </linearGradient>
      </defs>
      {candles.map((c, i) => (
        <g key={i}>
          <rect
            x={c.x + c.w / 2 - 1}
            y={c.wickTop}
            width={2}
            height={c.wickBot - c.wickTop}
            rx={1}
            fill="var(--candle)"
            opacity={0.45}
          />
          <rect x={c.x} y={c.bodyY} width={c.w} height={c.bodyH} rx={3} fill={`url(#${gid})`} />
          {/* thin top highlight = a soft lit edge */}
          <rect
            x={c.x}
            y={c.bodyY}
            width={c.w}
            height={Math.min(3, c.bodyH)}
            rx={3}
            fill="var(--candle)"
            opacity={0.9}
          />
        </g>
      ))}
    </svg>
  );
}

export function AppBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Far plane — small, most blurred, faintest. */}
      <div className="backdrop-drift-a absolute inset-0" style={{ filter: "blur(10px)", opacity: 0.11 }}>
        <CandleLayer seed={1337} count={15} scale={0.8} />
      </div>
      {/* Mid plane. */}
      <div className="backdrop-drift-b absolute inset-0" style={{ filter: "blur(6px)", opacity: 0.14 }}>
        <CandleLayer seed={4242} count={11} scale={1.2} />
      </div>
      {/* Near plane — largest, softer blur, still low opacity (depth-of-field). */}
      <div className="backdrop-drift-c absolute inset-0" style={{ filter: "blur(3.5px)", opacity: 0.08 }}>
        <CandleLayer seed={9001} count={7} scale={1.75} />
      </div>
      {/* Atmospheric top bloom. */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse 90% 60% at 50% -12%, var(--backdrop-glow), transparent 60%)" }}
      />
      {/* Vignette — fade the edges so the market feels integrated, not pasted on. */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse 130% 125% at 50% 42%, transparent 50%, var(--backdrop-vignette) 100%)" }}
      />
    </div>
  );
}
