/**
 * Native Replay chart palettes. Plain hex / rgba only — lightweight-charts'
 * colour parser rejects CSS Color 4 (`oklch`, `lab`) and `var(--x)`, which
 * Traditorium's tokens use. Values are hand-matched to the matte theme:
 * muted candles, faint grid, quiet crosshair.
 */
export interface ReplayChartPalette {
  background: string;
  text: string;
  grid: string;
  border: string;
  crosshair: string;
  crosshairLabel: string;
  up: string;
  down: string;
  upWick: string;
  downWick: string;
  volumeUp: string;
  volumeDown: string;
}

export const REPLAY_CHART_DARK: ReplayChartPalette = {
  background: "#16171a",
  text: "#9ea1a8",
  grid: "rgba(255, 255, 255, 0.035)",
  border: "rgba(255, 255, 255, 0.08)",
  crosshair: "rgba(210, 213, 220, 0.35)",
  crosshairLabel: "#30333a",
  up: "#4f9d86",
  down: "#c4655f",
  upWick: "#4f9d86",
  downWick: "#c4655f",
  volumeUp: "rgba(79, 157, 134, 0.35)",
  volumeDown: "rgba(196, 101, 95, 0.35)",
};

export const REPLAY_CHART_LIGHT: ReplayChartPalette = {
  background: "#fbfbfc",
  text: "#5b5f68",
  grid: "rgba(20, 24, 32, 0.045)",
  border: "rgba(20, 24, 32, 0.1)",
  crosshair: "rgba(40, 44, 52, 0.35)",
  crosshairLabel: "#3a3e46",
  up: "#2f8067",
  down: "#b24c46",
  upWick: "#2f8067",
  downWick: "#b24c46",
  volumeUp: "rgba(47, 128, 103, 0.3)",
  volumeDown: "rgba(178, 76, 70, 0.3)",
};

export function replayChartPalette(theme: string | undefined): ReplayChartPalette {
  return theme === "light" ? REPLAY_CHART_LIGHT : REPLAY_CHART_DARK;
}
