import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TimeConventionForm } from "@/components/broker-history/time-convention-form";
import type { BrokerHistoryDTO, BrokerPositionDTO } from "@/server/services/mt5-connector.service";

/**
 * MT5 Connector (Stage 1) — read-only Broker History. Server-rendered; the
 * only interactive control is the server-time convention form. Amounts are
 * shown exactly as MT5 reported them (decimal strings, account currency).
 */

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");

function money(value: string | null, currency: string | null) {
  if (value == null) return "—";
  const n = Number(value);
  const cls = n > 0 ? "text-emerald-600" : n < 0 ? "text-destructive" : "";
  return (
    <span className={cls}>
      {value}
      {currency ? ` ${currency}` : ""}
    </span>
  );
}

const STOP_SOURCE_LABEL: Record<string, string> = {
  OPENING_DEAL: "from opening deal",
  OPENING_ORDER: "from opening order",
  NONE_AT_OPEN: "none set at open",
  UNAVAILABLE: "unavailable in MT5 history",
};

const FLAG_LABEL: Record<string, string> = {
  INCOMPLETE_HISTORY: "Opening not in history",
  REVERSED: "Reversed",
  CLOSED_BY: "Close-by",
  PARTIALLY_CLOSED: "Partial closes",
  SCALED_IN: "Scaled in",
  VOLUME_EXCEEDS_OPEN: "Volume mismatch",
  DIRECTION_CONFLICT: "Inconsistent deal",
  CANCELED_DEAL_PRESENT: "Canceled deal",
};

function PositionRow({ p, currency }: { p: BrokerPositionDTO; currency: string | null }) {
  return (
    <details className="rounded-lg border border-border">
      <summary className="grid cursor-pointer grid-cols-2 gap-2 px-3 py-2 text-sm sm:grid-cols-[1.2fr_0.7fr_0.8fr_1fr_1fr_1fr]">
        <span className="font-medium">
          {p.symbol} <span className="text-xs text-muted-foreground">#{p.positionId}</span>
        </span>
        <span>{p.direction === "LONG" ? "Buy" : "Sell"}</span>
        <span>{p.status === "OPEN" ? <Badge>Open</Badge> : <Badge variant="outline">Closed</Badge>}</span>
        <span className="text-muted-foreground">{fmtTime(p.openedAt)}</span>
        <span className="text-muted-foreground">{fmtTime(p.closedAt)}</span>
        <span className="text-right">{money(p.netProfit, currency)}</span>
      </summary>
      <div className="space-y-3 border-t border-border px-3 py-3 text-xs">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>Volume in / out: {p.volumeIn} / {p.volumeOut}{p.status === "OPEN" ? ` (open ${p.openVolume})` : ""}</div>
          <div>Avg entry / exit: {p.avgEntryPrice ?? "—"} / {p.avgExitPrice ?? "—"}</div>
          <div>
            Initial SL: {p.initialStopLoss ?? "—"} <span className="text-muted-foreground">({STOP_SOURCE_LABEL[p.initialStopSource] ?? p.initialStopSource})</span>
          </div>
          <div>Initial TP: {p.initialTakeProfit ?? "—"}</div>
          <div>Profit: {money(p.profit, null)}</div>
          <div>Commission: {money(p.commission, null)}</div>
          <div>Swap: {money(p.swap, null)}</div>
          <div>Fee: {money(p.fee, null)}</div>
          {p.status === "OPEN" && p.live.observedAt && (
            <div className="col-span-2 sm:col-span-4 text-muted-foreground">
              Live (observed {fmtTime(p.live.observedAt)}): SL {p.live.stopLoss ?? "none"} · TP {p.live.takeProfit ?? "none"} · price {p.live.currentPrice ?? "—"} · floating{" "}
              {p.live.profit ?? "—"}
            </div>
          )}
        </div>
        {p.flags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {p.flags.map((f) => (
              <Badge key={f} variant="secondary">
                {FLAG_LABEL[f] ?? f}
              </Badge>
            ))}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-2 font-normal">Deal</th>
                <th className="py-1 pr-2 font-normal">Server time</th>
                <th className="py-1 pr-2 font-normal">Side</th>
                <th className="py-1 pr-2 font-normal">Entry</th>
                <th className="py-1 pr-2 font-normal">Volume</th>
                <th className="py-1 pr-2 font-normal">Price</th>
                <th className="py-1 pr-2 font-normal">SL / TP</th>
                <th className="py-1 pr-2 text-right font-normal">Profit</th>
                <th className="py-1 pr-2 text-right font-normal">Comm.</th>
                <th className="py-1 pr-2 text-right font-normal">Swap</th>
                <th className="py-1 text-right font-normal">Fee</th>
              </tr>
            </thead>
            <tbody>
              {p.deals.map((d) => (
                <tr key={d.ticket} className="border-t border-border/60">
                  <td className="py-1 pr-2 font-mono">{d.ticket}</td>
                  <td className="py-1 pr-2">{d.serverTime.replace("T", " ").slice(0, 19)}</td>
                  <td className="py-1 pr-2">{d.side ?? d.category}</td>
                  <td className="py-1 pr-2">{d.entry ?? "—"}</td>
                  <td className="py-1 pr-2">{d.volume ?? "—"}</td>
                  <td className="py-1 pr-2">{d.price ?? "—"}</td>
                  <td className="py-1 pr-2">
                    {d.stopLoss ?? "—"} / {d.takeProfit ?? "—"}
                  </td>
                  <td className="py-1 pr-2 text-right">{money(d.profit, null)}</td>
                  <td className="py-1 pr-2 text-right">{d.commission}</td>
                  <td className="py-1 pr-2 text-right">{d.swap}</td>
                  <td className="py-1 text-right">{d.fee}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

export function BrokerHistoryView({ history, tradingAccountId }: { history: BrokerHistoryDTO; tradingAccountId: string }) {
  const c = history.connection;
  const currency = c.accountCurrency;
  const s = history.snapshot;
  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings/integrations" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" /> Integrations
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Broker History · {history.accountName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          MT5 {c.login} @ {c.server}
          {c.brokerCompany ? ` · ${c.brokerCompany}` : ""} · last sync {fmtTime(c.lastSyncedAt)} · {c.status.toLowerCase().replace("_", " ")}
        </p>
      </div>

      <div className="flex gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Read-only record of what MT5 reports for this account. It is not part of your journal and does not change the account&apos;s balance, ledger or
          analytics. Journal linking arrives in a later stage.
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account (as last reported by MT5)</CardTitle>
            <CardDescription>{s ? `Captured ${fmtTime(s.capturedAt)}` : "No heartbeat received yet."}</CardDescription>
          </CardHeader>
          {s && (
            <CardContent className="grid grid-cols-2 gap-2 text-sm">
              <div>Balance: {money(s.balance, currency)}</div>
              <div>Equity: {money(s.equity, currency)}</div>
              <div>Margin: {s.margin}</div>
              <div>Free margin: {s.freeMargin}</div>
              <div>Credit: {s.credit}</div>
              <div>Floating P/L: {money(s.profit, currency)}</div>
            </CardContent>
          )}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sync</CardTitle>
            <CardDescription>
              {c.backfillCompletedAt ? `History import complete (${fmtTime(c.backfillCompletedAt)})` : "History import in progress…"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>
              {c.dealCount.toLocaleString()} deals · {c.orderCount.toLocaleString()} orders · {c.positionCount.toLocaleString()} positions
            </div>
            <div className="text-muted-foreground">
              Range (server time): {c.historyFrom?.replace("T", " ").slice(0, 16) ?? "—"} → {c.historyTo?.replace("T", " ").slice(0, 16) ?? "—"}
            </div>
            <div className="text-muted-foreground">Last heartbeat: {fmtTime(c.lastHeartbeatAt)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open positions (live)</CardTitle>
          <CardDescription>As reported by the terminal&apos;s latest heartbeat.</CardDescription>
        </CardHeader>
        <CardContent>
          {!s || s.openPositions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open positions reported.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-2 font-normal">Position</th>
                    <th className="py-1 pr-2 font-normal">Symbol</th>
                    <th className="py-1 pr-2 font-normal">Side</th>
                    <th className="py-1 pr-2 font-normal">Volume</th>
                    <th className="py-1 pr-2 font-normal">Open / current</th>
                    <th className="py-1 pr-2 font-normal">SL / TP</th>
                    <th className="py-1 text-right font-normal">Floating</th>
                  </tr>
                </thead>
                <tbody>
                  {s.openPositions.map((o) => (
                    <tr key={o.positionId} className="border-t border-border/60">
                      <td className="py-1 pr-2 font-mono text-xs">{o.positionId}</td>
                      <td className="py-1 pr-2">{o.symbol}</td>
                      <td className="py-1 pr-2">{o.type === "POSITION_TYPE_BUY" ? "Buy" : "Sell"}</td>
                      <td className="py-1 pr-2">{o.volume}</td>
                      <td className="py-1 pr-2">
                        {o.priceOpen} / {o.priceCurrent ?? "—"}
                      </td>
                      <td className="py-1 pr-2">
                        {o.sl ?? "—"} / {o.tp ?? "—"}
                      </td>
                      <td className="py-1 text-right">{money(o.profit, null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Positions</CardTitle>
          <CardDescription>
            Reconstructed from MT5 deals by position ID (hedging and netting). Expand a position to see its deals. Net = profit + commission + swap + fee.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {history.positions.length === 0 && <p className="text-sm text-muted-foreground">No positions synced yet.</p>}
          {history.positions.map((p) => (
            <PositionRow key={p.positionId} p={p} currency={currency} />
          ))}
          {history.pageCount > 1 && (
            <div className="flex items-center justify-between pt-2 text-sm">
              {history.page > 1 ? <Link href={`?page=${history.page - 1}`}>← Newer</Link> : <span />}
              <span className="text-muted-foreground">
                Page {history.page} of {history.pageCount}
              </span>
              {history.page < history.pageCount ? <Link href={`?page=${history.page + 1}`}>Older →</Link> : <span />}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Balance operations</CardTitle>
          <CardDescription>Deposits, withdrawals, credits, charges and other non-trade deals (latest 200).</CardDescription>
        </CardHeader>
        <CardContent>
          {history.balanceOperations.length === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <tbody>
                {history.balanceOperations.map((d) => (
                  <tr key={d.ticket} className="border-t border-border/60">
                    <td className="py-1 pr-2 text-muted-foreground">{d.serverTime.replace("T", " ").slice(0, 16)}</td>
                    <td className="py-1 pr-2">{d.category.toLowerCase()}</td>
                    <td className="py-1 pr-2 text-muted-foreground">{d.comment ?? ""}</td>
                    <td className="py-1 text-right">{money(d.profit, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {history.recentRejections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Records MT5 sent that could not be stored</CardTitle>
            <CardDescription>Shown so nothing is dropped silently. These records were not imported.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(history.recentRejections, null, 2)}</pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Server time</CardTitle>
          <CardDescription>
            MT5 reports times in the broker server&apos;s clock. Raw server times are always kept; this setting only controls how they map to UTC. Currently:{" "}
            {c.timeConventionLabel}.
            {c.observedOffsetMinutes != null ? ` The terminal currently reports GMT${c.observedOffsetMinutes >= 0 ? "+" : ""}${c.observedOffsetMinutes / 60}.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TimeConventionForm connectionId={c.id} current={c.timeConvention} key={tradingAccountId} />
        </CardContent>
      </Card>
    </div>
  );
}
