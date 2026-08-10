// Floating candlestick backdrop — a non-interactive decorative layer that sits
// behind the entire app (fixed, -z-10, pointer-events-none, aria-hidden). Three
// depth planes of candles form a market TRENDING across the viewport, viewed from a
// comfortable distance: clearly candlesticks, small and numerous, softly blurred and
// at extremely low opacity so they read as atmosphere floating behind the workspace —
// never a chart, never competing with content. Foreground glass cards (translucent)
// naturally soften the candles beneath them.
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

/**
 * A dense-ish series of small candles following a directional TREND from startFrac
 * (left) to endFrac (right) — smaller/larger Y = higher/lower on screen — with
 * volatility noise + slow swings for realistic pullbacks. Small `scale` keeps the
 * candles "seen from afar": recognizable, not zoomed in.
 */
function makeCandles(
  seed: number,
  count: number,
  scale: number,
  startFrac: number,
  endFrac: number,
  phase: number,
): Candle[] {
  const r = rng(seed);
  const out: Candle[] = [];
  const gap = W / count;
  for (let i = 0; i < count; i += 1) {
    const t = count > 1 ? i / (count - 1) : 0;
    const trendY = H * (startFrac + (endFrac - startFrac) * t); // the trend line
    const noise = (r() - 0.5) * H * 0.1; // candle-to-candle volatility
    const swing = Math.sin(t * Math.PI * 3 + phase) * H * 0.05; // gentle pullbacks
    const baseline = Math.max(H * 0.12, Math.min(H * 0.88, trendY + noise + swing));
    const w = (13 + r() * 14) * scale;
    const bodyH = (24 + r() * 66) * scale;
    const bodyY = baseline - bodyH / 2;
    const wickUp = (14 + r() * 44) * scale;
    const wickDn = (14 + r() * 44) * scale;
    const x = i * gap + (gap - w) / 2 + (r() - 0.5) * gap * 0.2;
    out.push({ x, w, bodyY, bodyH, wickTop: bodyY - wickUp, wickBot: bodyY + bodyH + wickDn });
  }
  return out;
}

function CandleLayer({ candles, idKey }: { candles: Candle[]; idKey: string }) {
  const gid = `cbody-${idKey}`;
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
            x={c.x + c.w / 2 - 0.75}
            y={c.wickTop}
            width={1.5}
            height={c.wickBot - c.wickTop}
            rx={0.75}
            fill="var(--candle)"
            opacity={0.5}
          />
          <rect x={c.x} y={c.bodyY} width={c.w} height={c.bodyH} rx={2} fill={`url(#${gid})`} />
          {/* thin top highlight = a soft lit edge */}
          <rect
            x={c.x}
            y={c.bodyY}
            width={c.w}
            height={Math.min(2, c.bodyH)}
            rx={2}
            fill="var(--candle)"
            opacity={0.9}
          />
        </g>
      ))}
    </svg>
  );
}

export function AppBackdrop() {
  // One coherent uptrend across all planes (low-left → high-right), each plane a
  // little different for parallax depth. Far = many/small/most blurred/faintest.
  const far = makeCandles(1337, 44, 0.42, 0.74, 0.4, 0);
  const mid = makeCandles(4242, 32, 0.56, 0.72, 0.34, 1.1);
  const near = makeCandles(9001, 22, 0.74, 0.7, 0.3, 2.2);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="backdrop-drift-a absolute inset-0" style={{ filter: "blur(6px)", opacity: 0.1 }}>
        <CandleLayer candles={far} idKey="far" />
      </div>
      <div className="backdrop-drift-b absolute inset-0" style={{ filter: "blur(3.5px)", opacity: 0.13 }}>
        <CandleLayer candles={mid} idKey="mid" />
      </div>
      <div className="backdrop-drift-c absolute inset-0" style={{ filter: "blur(2px)", opacity: 0.1 }}>
        <CandleLayer candles={near} idKey="near" />
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
