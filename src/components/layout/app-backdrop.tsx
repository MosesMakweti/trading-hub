// Floating candlestick backdrop — a non-interactive decorative layer behind the
// whole app (fixed, -z-10, pointer-events-none, aria-hidden). It renders a single,
// continuous OHLC price path (tight sequential candles forming real market
// structure) rising off a reflective horizon, mirrored below like a glossy desk —
// with a soft bloom, a moving-average line and faint volume bars — then softened
// with blur + a top fade + a vignette. Cinematic in dark mode (the candles are the
// light source), restrained in light. It reads as the STRUCTURE of a real chart
// with the DEPTH of a 3D scene, never a readable TradingView chart and never
// competing with content; foreground glass cards soften whatever sits beneath them.
//
// Pure SVG + CSS (a few KB, no image download). Geometry is generated
// deterministically (seeded) so server and client render identically; candle color
// + intensity come from tokens (`--candle`, `--backdrop-strength`) so it flips with
// the theme. The only motion is a very slow GPU drift, disabled under reduced-motion.

const W = 1600;
const H = 900;
const N = 96; // candle count — dense enough to flow like a real chart
const CHART_TOP = 245; // candle tops start well below the header (chart sits low on the page)
const HORIZON = 735; // reflective surface near the bottom (volume by the bottom axis)
const CHART_BOT = HORIZON - 74; // clear strip at the base for the volume
const AMP = 1.5; // price-move amplitude — extra-tall candle bodies/wicks
const HEIGHT_SCALE = 3; // per-candle visual height multiplier (around each candle's centre)

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

/** Standard normal via Box–Muller — natural, non-uniform candle variation. */
function gauss(r: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

interface OHLC {
  open: number;
  high: number;
  low: number;
  close: number;
}

// Regime script: a believable market — impulses, pullbacks, consolidation, a
// breakout, a reversal. Walking it yields real swing highs/lows, not random candles.
const REGIMES: { drift: number; vol: number; len: [number, number] }[] = [
  { drift: 0.0, vol: 0.009, len: [8, 13] },
  { drift: 0.021, vol: 0.014, len: [7, 11] },
  { drift: -0.009, vol: 0.01, len: [4, 8] },
  { drift: 0.0, vol: 0.008, len: [8, 14] },
  { drift: 0.027, vol: 0.018, len: [6, 11] }, // breakout — tends to spike
  { drift: -0.008, vol: 0.009, len: [4, 7] },
  { drift: 0.013, vol: 0.013, len: [6, 10] },
  { drift: -0.024, vol: 0.017, len: [8, 12] }, // reversal down
  { drift: 0.007, vol: 0.011, len: [6, 10] },
];

function makeSeries(seed: number): OHLC[] {
  const r = rng(seed);
  const out: OHLC[] = [];
  let v = 0.4;
  let ri = 0;
  let reg = REGIMES[0];
  let left = Math.round(reg.len[0] + r() * (reg.len[1] - reg.len[0]));
  for (let i = 0; i < N; i += 1) {
    if (left <= 0) {
      ri += 1;
      reg = REGIMES[ri % REGIMES.length];
      left = Math.round(reg.len[0] + r() * (reg.len[1] - reg.len[0]));
    }
    left -= 1;
    const open = v;
    const disp = r() < 0.08 ? 2.6 : 1; // occasional strong displacement candle
    v = Math.max(0.05, Math.min(0.95, open + reg.drift + gauss(r) * reg.vol * AMP * disp));
    const close = v;
    const hi = Math.max(open, close);
    const lo = Math.min(open, close);
    out.push({
      open,
      close,
      high: Math.min(0.99, hi + Math.abs(gauss(r)) * reg.vol * AMP + 0.01),
      low: Math.max(0.01, lo - Math.abs(gauss(r)) * reg.vol * AMP - 0.01),
    });
  }
  return out;
}

/** The scene group (candles + wicks + volume + moving-average), in viewBox space. */
function Scene({ series }: { series: OHLC[] }) {
  const slot = W / N;
  const bw = slot * 0.62;
  const vY = (val: number) => CHART_TOP + (1 - val) * (CHART_BOT - CHART_TOP);

  return (
    <g id="scene">
      {/* Faint volume bars — a low, compact strip at the base by the horizon. */}
      {series.map((o, i) => {
        const vol = Math.abs(o.close - o.open) * 2.4 + Math.abs(o.high - o.low) * 0.6;
        const volH = Math.min(54, 8 + vol * 165);
        return (
          <rect
            key={`v${i}`}
            x={i * slot + (slot - bw) / 2}
            y={HORIZON - volH}
            width={bw}
            height={volH}
            fill="var(--candle)"
            opacity={0.12}
          />
        );
      })}
      {/* Candles. Each candle's height (body + wicks) is exaggerated ×HEIGHT_SCALE
          around its own centre — the trend/structure (candle centres, the price
          path) is untouched; the individual candles just read much taller. */}
      {series.map((o, i) => {
        const up = o.close >= o.open;
        const yHigh = vY(o.high);
        const yLow = vY(o.low);
        const centre = (yHigh + yLow) / 2;
        const grow = (y: number) => centre + (y - centre) * HEIGHT_SCALE;
        const bodyTop = grow(vY(Math.max(o.open, o.close)));
        const bodyH = Math.max(1.4, grow(vY(Math.min(o.open, o.close))) - bodyTop);
        const wickTop = grow(yHigh);
        const cx = i * slot + slot / 2;
        return (
          <g key={`c${i}`}>
            <rect x={cx - 0.7} y={wickTop} width={1.4} height={grow(yLow) - wickTop} fill="var(--candle)" opacity={0.55} />
            <rect
              x={i * slot + (slot - bw) / 2}
              y={bodyTop}
              width={bw}
              height={bodyH}
              rx={1.5}
              fill={up ? "url(#cbody)" : "var(--candle)"}
              opacity={up ? 1 : 0.82}
            />
          </g>
        );
      })}
    </g>
  );
}

export function AppBackdrop() {
  const series = makeSeries(20260810);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="backdrop-drift-a absolute inset-0"
        style={{ filter: "blur(2.8px)", opacity: "var(--backdrop-strength)" }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id="cbody" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--candle)" stopOpacity="1" />
              <stop offset="60%" stopColor="var(--candle)" stopOpacity="0.78" />
              <stop offset="100%" stopColor="var(--candle)" stopOpacity="0.6" />
            </linearGradient>
            {/* Bloom = a heavily-blurred copy of the scene → the glow. */}
            <filter id="bloom" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="7" />
            </filter>
            {/* Reflection fade — brightest at the horizon, gone by the bottom. */}
            <linearGradient id="reflGrad" x1="0" y1={HORIZON} x2="0" y2={H} gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask id="reflMask">
              <rect x="0" y={HORIZON} width={W} height={H - HORIZON} fill="url(#reflGrad)" />
            </mask>
            <Scene series={series} />
          </defs>

          {/* Bloom behind, then the crisp scene, then the mirrored reflection. */}
          <use href="#scene" filter="url(#bloom)" opacity={0.55} />
          <use href="#scene" />
          <use
            href="#scene"
            transform={`translate(0 ${2 * HORIZON}) scale(1 -1)`}
            mask="url(#reflMask)"
            opacity={0.5}
          />
          {/* Reflective surface highlight — a soft streak of light on the horizon. */}
          <ellipse cx={W * 0.44} cy={HORIZON} rx={W * 0.42} ry={7} fill="var(--candle)" opacity={0.14} />
        </svg>
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
      {/* Vignette — fade the edges so the market feels integrated, not pasted on. */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse 135% 130% at 50% 46%, transparent 46%, var(--backdrop-vignette) 100%)" }}
      />
    </div>
  );
}
