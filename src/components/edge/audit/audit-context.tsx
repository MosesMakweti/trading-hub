"use client";

import { createContext, useContext } from "react";

export interface AuditScopeValue {
  weekStart: string;
  strategyId: string | null;
  assetSymbols: string[];
}

interface AuditContextValue {
  scope: AuditScopeValue;
  /** True when the week is finalized: everything renders read-only. */
  locked: boolean;
  uploadsEnabled: boolean;
  /** The trader's strategies (for tagging a missed setup). */
  strategies: { id: string; name: string }[];
}

const AuditContext = createContext<AuditContextValue | null>(null);

export const AuditProvider = AuditContext.Provider;

export function useAudit(): AuditContextValue {
  const ctx = useContext(AuditContext);
  if (!ctx) throw new Error("useAudit must be used inside <AuditProvider>.");
  return ctx;
}

const priceFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 5 });

export function fmtPrice(n: number | null | undefined): string {
  return n == null ? "—" : priceFormat.format(n);
}

export function fmtR(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}R`;
}

export function fmtPnl(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function toneOf(n: number | null | undefined): string {
  if (n == null || Math.abs(n) < 0.001) return "text-muted-foreground";
  return n > 0 ? "text-success" : "text-danger";
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dayLabel(dateKey: string): { weekday: string; short: string; date: string } {
  const [y, m, d] = dateKey.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { weekday: WEEKDAY[wd], short: WEEKDAY[wd].slice(0, 3), date: `${d} ${MONTH[m - 1]}` };
}

export function newClientKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
