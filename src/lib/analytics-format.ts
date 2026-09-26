// Pure formatting/classification helpers shared by server-rendered analytics
// components and client-only chart components. Kept out of any "use client"
// module: a Server Component that imports a plain function from a client
// module gets a client-reference proxy instead of the real function, and
// calling it throws ("Attempted to call X() from the server but X is on the
// client") — these helpers have no client-only dependency, so they belong here.

export function fmtR(n: number | null): string {
  return n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}

export function fmtUsd(n: number): string {
  // The sign was previously dropped for losses (−500 rendered "$500").
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function tone(n: number | null | undefined): "success" | "danger" | "neutral" {
  if (n == null) return "neutral";
  return n > 0 ? "success" : n < 0 ? "danger" : "neutral";
}
