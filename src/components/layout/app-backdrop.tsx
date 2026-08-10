// Floating candlestick backdrop — a non-interactive decorative layer behind the
// whole app (fixed, -z-10, pointer-events-none, aria-hidden). It is a single,
// continuous OHLC price path — tight sequential candles that collectively form real
// market structure (impulses, pullbacks, consolidations, breakouts, a reversal) —
// then stylized for depth: an aligned soft glow behind, a tight dark contact shadow
// beneath, and a light atmospheric blur + vignette over the top. It reads as the
// STRUCTURE of a real chart with the DEPTH of a 3D background, never a readable
// TradingView chart and never competing with content. Foreground glass cards
// (translucent) naturally soften the candles beneath them.
//
// Pure SVG + CSS (a few KB, no image download). Geometry is generated
// deterministically (seeded) so server and client render identically; candle color
// comes from a token (`--candle`) so it flips with the theme. The only motion is a
// very slow GPU drift, disabled under prefers-reduced-motion.

const W = 1600;
const H = 900;
const N = 120; // candle count — dense enough to flow like a real chart
const PAD_T = 0.16;
const PAD_B = 0.16;

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

/** Standard normal via Box–Muller — gives natural, non-uniform candle variation. */
function gauss(r: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

interface Bar {
  bx: number;
  bw: number;
  bodyTop: number;
  bodyH: number;
  wickX: number;
  wickTop: number;
  wickBot: number;
  up: boolean;
}

// Regime script: a believable sequence of market phases. Each phase has a drift
// (per-bar trend), volatility, and a length range. Walking these in order yields
// impulses → pullbacks → consolidation → breakout → reversal with real swing
// highs/lows — not random placement.
const REGIMES: { drift: number; vol: number; len: [number, number] }[] = [
  { drift: 0.0, vol: 0.009, len: [9, 15] }, // base consolidation
  { drift: 0.02, vol: 0.014, len: [7, 12] }, // impulse up
  { drift: -0.009, vol: 0.01, len: [5, 9] }, // pullback
  { drift: 0.0, vol: 0.008, len: [9, 16] }, // consolidation
  { drift: 0.024, vol: 0.017, len: [7, 12] }, // breakout up
  { drift: -0.007, vol: 0.009, len: [4, 8] }, // shallow pullback
  { drift: 0.012, vol: 0.013, len: [6, 10] }, // continuation
  { drift: -0.023, vol: 0.017, len: [8, 13] }, // reversal down
  { drift: 0.008, vol: 0.011, len: [6, 11] }, // recovery
];

function makeSeries(seed: number): Bar[] {
  const r = rng(seed);
  const slot = W / N;
  const bw = slot * 0.66; // body width; gap = 0.34·slot < body → tight, continuous
  const innerH = H * (1 - PAD_T - PAD_B);
  const vY = (val: number) => H * PAD_T + (1 - val) * innerH; // value 0..1 → y

  const bars: Bar[] = [];
  let v = 0.42; // starting price (value space, higher = higher on screen)
  let ri = 0;
  let left = Math.round(REGIMES[0].len[0] + r() * (REGIMES[0].len[1] - REGIMES[0].len[0]));
  let reg = REGIMES[0];

  for (let i = 0; i < N; i += 1) {
    if (left <= 0) {
      ri += 1;
      reg = REGIMES[ri % REGIMES.length];
      left = Math.round(reg.len[0] + r() * (reg.len[1] - reg.len[0]));
    }
    left -= 1;

    const open = v;
    const displacement = r() < 0.06 ? 2.3 : 1; // occasional strong displacement candle
    const step = reg.drift + gauss(r) * reg.vol * displacement;
    v = Math.max(0.06, Math.min(0.94, open + step));
    const close = v;

    const hi = Math.max(open, close);
    const lo = Math.min(open, close);
    const wickUp = Math.abs(gauss(r)) * reg.vol * 0.9 + 0.004;
    const wickDn = Math.abs(gauss(r)) * reg.vol * 0.9 + 0.004;
    const high = Math.min(0.99, hi + wickUp);
    const low = Math.max(0.01, lo - wickDn);

    const yHi = vY(hi);
    const yLo = vY(lo);
    const bx = i * slot + (slot - bw) / 2;
    bars.push({
      bx,
      bw,
      bodyTop: yHi,
      bodyH: Math.max(1.3, yLo - yHi),
      wickX: i * slot + slot / 2,
      wickTop: vY(high),
      wickBot: vY(low),
      up: close >= open,
    });
  }
  return bars;
}

/** One rendering of the shared bar geometry. `mode` styles the same candles as the
 *  glow (behind), the contact shadow (beneath), or the main candles (front). */
function CandleSvg({ bars, mode }: { bars: Bar[]; mode: "glow" | "shadow" | "main" }) {
  const shadow = mode === "shadow";
  const fill = shadow ? "#000" : "var(--candle)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
      {mode === "main" && (
        <defs>
          <linearGradient id="cbody" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--candle)" stopOpacity="0.98" />
            <stop offset="60%" stopColor="var(--candle)" stopOpacity="0.74" />
            <stop offset="100%" stopColor="var(--candle)" stopOpacity="0.55" />
          </linearGradient>
        </defs>
      )}
      {bars.map((b, i) => {
        // Glow = bodies only (a soft aligned halo); shadow/main = wick + body.
        const bodyFill = mode === "main" ? (b.up ? "url(#cbody)" : "var(--candle)") : fill;
        const bodyOpacity = mode === "main" ? (b.up ? 1 : 0.82) : 1;
        return (
          <g key={i}>
            {mode !== "glow" && (
              <rect
                x={b.wickX - 0.7}
                y={b.wickTop}
                width={1.4}
                height={b.wickBot - b.wickTop}
                fill={fill}
                opacity={shadow ? 1 : 0.55}
              />
            )}
            <rect
              x={b.bx}
              y={b.bodyTop}
              width={b.bw}
              height={b.bodyH}
              rx={1.5}
              fill={bodyFill}
              opacity={bodyOpacity}
            />
          </g>
        );
      })}
    </svg>
  );
}

export function AppBackdrop() {
  const bars = makeSeries(20260810);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* All three planes share ONE drift so they stay perfectly aligned — a single
          chart with depth, not offset copies. */}
      <div className="backdrop-drift-a absolute inset-0">
        {/* Depth glow — the same path, heavily blurred + very faint, aligned behind. */}
        <div className="absolute inset-0" style={{ filter: "blur(13px)", opacity: 0.05 }}>
          <CandleSvg bars={bars} mode="glow" />
        </div>
        {/* Contact shadow — the same path in black, nudged down 1.4px, tightly
            blurred + faint. Grounds the candles (ambient depth), never a copy. */}
        <div className="absolute inset-0" style={{ filter: "blur(3px)", opacity: 0.22 }}>
          <div style={{ transform: "translateY(1.4px)" }}>
            <CandleSvg bars={bars} mode="shadow" />
          </div>
        </div>
        {/* Main candles — lightly blurred so the structure reads, but soft. */}
        <div className="absolute inset-0" style={{ filter: "blur(1.8px)", opacity: 0.16 }}>
          <CandleSvg bars={bars} mode="main" />
        </div>
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
