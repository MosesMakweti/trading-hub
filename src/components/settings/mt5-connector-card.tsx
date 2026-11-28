"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, KeyRound, Pause, Play, PlugZap, Trash2, Unplug } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  deleteMt5BrokerHistoryAction,
  disconnectMt5ConnectionAction,
  generateMt5PairingCodeAction,
  listMt5AccountsAction,
  pauseMt5ConnectionAction,
  resumeMt5ConnectionAction,
} from "@/actions/mt5-connector.actions";
import type { Mt5AccountOptionDTO, Mt5ConnectionSummaryDTO } from "@/server/services/mt5-connector.service";

/**
 * MT5 Connector (Stage 1) — Settings → Integrations card. Pair an MT5
 * terminal (read-only Expert Advisor) with one Traditorium account, watch
 * its sync, pause/resume, disconnect. Broker history is account-side only:
 * nothing here creates journal entries or changes balances.
 */

function when(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function statusBadge(connection: Mt5ConnectionSummaryDTO | null) {
  if (!connection) return <Badge variant="outline">Not connected</Badge>;
  switch (connection.status) {
    case "PENDING_PAIRING":
      return <Badge variant="secondary">Waiting for pairing</Badge>;
    case "ACTIVE":
      return connection.stale ? <Badge variant="destructive">Connected · no heartbeat</Badge> : <Badge>Connected</Badge>;
    case "PAUSED":
      return <Badge variant="secondary">Paused</Badge>;
    case "REVOKED":
      return <Badge variant="outline">Disconnected</Badge>;
  }
}

function PairingCode({ code, expiresAt }: { code: string; expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const remaining = Math.max(0, new Date(expiresAt).getTime() - now);
  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);
  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
      <div className="text-xs text-muted-foreground">Pairing code — enter it in the Expert Advisor&apos;s inputs</div>
      <div className="mt-1 font-mono text-2xl font-semibold tracking-widest">{code}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {remaining > 0 ? `Expires in ${mm}:${String(ss).padStart(2, "0")} · single use` : "Expired — generate a new code."}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-sm">{value}</div>
    </div>
  );
}

function AccountRow({ option, onChanged }: { option: Mt5AccountOptionDTO; onChanged: () => Promise<void> }) {
  const [isPending, startTransition] = useTransition();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const c = option.connection;
  const connected = c?.status === "ACTIVE" || c?.status === "PAUSED";
  const canPair = !connected && !option.statementImportConflict;

  function run(action: () => Promise<{ success: boolean; error?: string }>, done?: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.success) {
        toast.error(result.error ?? "Something went wrong.");
        return;
      }
      if (done) toast.success(done);
      await onChanged();
    });
  }

  function generate() {
    startTransition(async () => {
      const result = await generateMt5PairingCodeAction(option.tradingAccountId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setCode({ code: result.code, expiresAt: result.expiresAt });
      await onChanged();
    });
  }

  return (
    <div className="glass space-y-3 rounded-xl px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            {option.name}
            <span className="text-xs font-normal text-muted-foreground">{option.kind === "PROP_FIRM" ? "Prop firm" : "Brokerage"}</span>
          </div>
          {c?.login && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              MT5 {c.login} @ {c.server}
              {c.brokerCompany ? ` · ${c.brokerCompany}` : ""}
              {c.tradeMode ? ` · ${c.tradeMode}` : ""}
              {c.marginMode ? ` · ${c.marginMode.toLowerCase()}` : ""}
              {c.accountCurrency ? ` · ${c.accountCurrency}` : ""}
            </div>
          )}
        </div>
        {statusBadge(c)}
      </div>

      {option.statementImportConflict && (
        <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
          <span>
            This account already has {option.statementImportConflict.confirmedBatches} imported broker statement
            {option.statementImportConflict.confirmedBatches === 1 ? "" : "s"}
            {option.statementImportConflict.latestFileName ? ` (${option.statementImportConflict.latestFileName})` : ""}. Connecting MT5 would record the
            same history twice, so pairing is disabled. Roll the statement import back first, or connect a different account.
          </span>
        </div>
      )}

      {c && c.status !== "PENDING_PAIRING" && c.pairedAt && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact
            label="History import"
            value={c.backfillCompletedAt ? `Complete · ${when(c.backfillCompletedAt)}` : c.status === "REVOKED" ? "Stopped" : "In progress…"}
          />
          <Fact label="Deals / orders" value={`${c.dealCount.toLocaleString()} / ${c.orderCount.toLocaleString()}`} />
          <Fact label="Positions (open)" value={`${c.positionCount.toLocaleString()} (${c.openPositionCount})`} />
          <Fact label="Last successful sync" value={when(c.lastSyncedAt)} />
          <Fact label="Last heartbeat" value={when(c.lastHeartbeatAt)} />
          <Fact label="History range (server time)" value={c.historyFrom ? `${c.historyFrom.slice(0, 10)} → ${c.historyTo?.slice(0, 10)}` : "—"} />
          <Fact label="Server time" value={c.timeConventionLabel} />
          {c.revokedAt && <Fact label="Disconnected" value={`${when(c.revokedAt)}${c.revokedReason ? ` · ${c.revokedReason}` : ""}`} />}
        </div>
      )}

      {c?.offsetMismatch && (
        <p className="text-xs text-amber-600">
          The terminal now reports a different server offset than the one history was normalized with (daylight saving?). Review the server-time
          setting on the Broker History page.
        </p>
      )}

      {code && c?.status === "PENDING_PAIRING" && <PairingCode code={code.code} expiresAt={code.expiresAt} />}
      {!code && c?.status === "PENDING_PAIRING" && (
        <p className="text-xs text-muted-foreground">A pairing code was issued{c.pairingExpiresAt ? ` (expires ${when(c.pairingExpiresAt)})` : ""}. Generate a new one if you no longer have it.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {canPair && (
          <Button type="button" size="sm" onClick={generate} disabled={isPending}>
            <KeyRound className="size-3.5" />
            {c?.status === "REVOKED" ? "Reconnect (new pairing code)" : c?.status === "PENDING_PAIRING" ? "New pairing code" : "Generate pairing code"}
          </Button>
        )}
        {c && c.pairedAt && (
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/accounts/${option.tradingAccountId}/broker-history`} />}>
            Broker History
            <ArrowRight className="size-3.5" />
          </Button>
        )}
        {c?.status === "ACTIVE" && (
          <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => run(() => pauseMt5ConnectionAction(c.id), "Sync paused.")}>
            <Pause className="size-3.5" />
            Pause
          </Button>
        )}
        {c?.status === "PAUSED" && (
          <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => run(() => resumeMt5ConnectionAction(c.id), "Sync resumed.")}>
            <Play className="size-3.5" />
            Resume
          </Button>
        )}
        {c && (c.status === "ACTIVE" || c.status === "PAUSED" || c.status === "PENDING_PAIRING") && (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={isPending}>
                  <Unplug className="size-3.5" />
                  Disconnect
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect MT5 from &ldquo;{option.name}&rdquo;?</AlertDialogTitle>
                <AlertDialogDescription>
                  The connector&apos;s token stops working immediately. Broker history already synced stays on the account (read-only) until you delete it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => run(() => disconnectMt5ConnectionAction(c.id), "Disconnected.")}>Disconnect</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {c?.status === "REVOKED" && (c.dealCount > 0 || c.orderCount > 0) && (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={isPending}>
                  <Trash2 className="size-3.5" />
                  Delete broker history
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete all MT5 broker history for &ldquo;{option.name}&rdquo;?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes {c.dealCount.toLocaleString()} deals, {c.orderCount.toLocaleString()} orders and every derived position synced from MT5{" "}
                  {c.login}. Your journal, trades and balances are not affected. This can&apos;t be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => run(() => deleteMt5BrokerHistoryAction(c.id), "Broker history deleted.")}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}

export function Mt5ConnectorCard({ initialAccounts }: { initialAccounts: Mt5AccountOptionDTO[] }) {
  const [accounts, setAccounts] = useState(initialAccounts);
  // The URL the trader must whitelist in MT5's WebRequest options.
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );

  async function refresh() {
    const result = await listMt5AccountsAction();
    if (result.success) setAccounts(result.accounts);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PlugZap className="size-4" />
          MetaTrader 5 Connector
        </CardTitle>
        <CardDescription>
          A read-only Expert Advisor syncs an MT5 account&apos;s full trading history and live activity into that account&apos;s Broker History. It never
          places, modifies or closes trades, and Traditorium never asks for your MT5 password. Synced history does not create journal entries.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <details className="rounded-lg border border-border p-3 text-sm">
          <summary className="cursor-pointer font-medium">How to connect (Windows MT5 desktop)</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>
              In MT5: <em>Tools → Options → Expert Advisors</em>, tick <em>Allow WebRequest for listed URL</em> and add{" "}
              <code className="rounded bg-muted px-1">{origin || "your Traditorium address"}</code>.
            </li>
            <li>
              Copy <code className="rounded bg-muted px-1">TraditoriumConnector.mq5</code> into <em>File → Open Data Folder → MQL5/Experts</em>, then compile it
              in MetaEditor (F7).
            </li>
            <li>Generate a pairing code below for the account you want to sync.</li>
            <li>
              Attach the EA to any chart of the logged-in account. Enter the server URL and the pairing code in its inputs. <em>Algo Trading</em> does not need
              to be enabled — the EA never trades.
            </li>
            <li>The EA imports all available history in batches, then streams new deals and sends a heartbeat every minute.</li>
          </ol>
        </details>

        {accounts.length === 0 && <p className="text-sm text-muted-foreground">Add a prop-firm or brokerage account first — MT5 connects to one of your accounts.</p>}
        <div className="space-y-2">
          {accounts.map((option) => (
            <AccountRow key={option.tradingAccountId} option={option} onChanged={refresh} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
