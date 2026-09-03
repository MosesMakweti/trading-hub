"use client";

import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import type { PreviewPayoutRow, PreviewSummary } from "@/server/services/prop-firm-import.service";
import type { TransactionClassification } from "@/domain/prop-firms/import/classify-transaction";

const CLASSIFICATION_LABELS: Record<TransactionClassification, string> = {
  DEPOSIT: "Deposit",
  WITHDRAWAL_PAYOUT: "Payout (withdrawal)",
  WITHDRAWAL_UNCLASSIFIED: "Withdrawal (unclassified)",
  INTERNAL_TRANSFER: "Internal transfer",
  ACCOUNT_RESET: "Account reset",
  FEE: "Fee",
  COMMISSION: "Commission",
  REFUND: "Refund",
  BALANCE_CORRECTION: "Balance correction",
  CREDIT: "Credit",
  UNKNOWN: "Unknown",
};

const CLASSIFICATIONS = Object.keys(CLASSIFICATION_LABELS) as TransactionClassification[];

const PLATFORM_LABELS: Record<string, string> = {
  MT4: "MetaTrader 4",
  MT5: "MetaTrader 5",
  CTRADER: "cTrader",
  NINJATRADER: "NinjaTrader",
  TRADOVATE: "Tradovate",
  GENERIC_CSV: "Generic mapping",
};

function num(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h4>
        {count != null && <Badge variant="outline">{count}</Badge>}
      </div>
      {children}
    </div>
  );
}

function PayoutRow({
  row,
  override,
  onOverride,
}: {
  row: PreviewPayoutRow;
  override?: TransactionClassification;
  onOverride: (dedupeKey: string, classification: TransactionClassification) => void;
}) {
  const effective = override ?? row.classification;
  return (
    <div className="rounded-lg border border-border px-3.5 py-2.5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">{row.rawType || "—"}</div>
          <div className="text-xs text-muted-foreground">
            {new Date(row.occurredAt).toLocaleDateString()} · {formatCurrency(Math.abs(num(row.amount)))}
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>Gross {formatCurrency(Math.abs(num(row.amount)))}</div>
          {row.traderPayout != null ? (
            <>
              <div className="font-medium text-foreground">
                Trader receives {formatCurrency(num(row.traderPayout))}
              </div>
              <div>
                Prop-firm share {formatCurrency(num(row.propFirmShare ?? "0"))} · split{" "}
                {row.profitSplitPercentUsed ?? "—"}%
              </div>
            </>
          ) : (
            <div className="text-warning">Set the profit split to compute this payout</div>
          )}
        </div>
      </div>
      {row.requiresReview && (
        <div className="mt-2 flex items-center gap-2">
          <AlertTriangle className="size-3.5 shrink-0 text-warning" />
          <span className="text-xs text-muted-foreground">Low confidence — confirm what this is:</span>
          <Select value={effective} onValueChange={(v) => v && onOverride(row.dedupeKey, v as TransactionClassification)}>
            <SelectTrigger size="sm" aria-label="Classification">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {CLASSIFICATIONS.map((c) => (
                <SelectItem key={c} value={c}>
                  {CLASSIFICATION_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

export function ImportPreview({
  preview,
  overrides,
  onOverride,
  profitSplitInput,
}: {
  preview: PreviewSummary;
  overrides: Record<string, TransactionClassification>;
  onOverride: (dedupeKey: string, classification: TransactionClassification) => void;
  /** Non-null when the account has no profit split configured and this import
   *  has payouts — the user must supply a % before confirm is allowed. */
  profitSplitInput?: { value: string; onChange: (v: string) => void } | null;
}) {
  const fees =
    num(preview.feesAndCommissions.commission) +
    num(preview.feesAndCommissions.swap) +
    num(preview.feesAndCommissions.otherFees);
  const balanceDelta = num(preview.expectedBalanceChange);

  const mappingEntries = Object.entries(preview.columnMappingUsed);

  return (
    <div className="space-y-4">
      <div className="space-y-1 rounded-lg border border-border px-3.5 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            <span className="text-muted-foreground">Format:</span>{" "}
            <span className="font-medium">{preview.fileFormat}</span>
          </span>
          <span>
            <span className="text-muted-foreground">Platform:</span>{" "}
            <span className="font-medium">{PLATFORM_LABELS[preview.platform] ?? preview.platform}</span>
          </span>
          {preview.sheetOrTableName && (
            <span>
              <span className="text-muted-foreground">Sheet / table:</span>{" "}
              <span className="font-medium">{preview.sheetOrTableName}</span>
            </span>
          )}
        </div>
        {mappingEntries.length > 0 && (
          <div className="text-muted-foreground">
            <span>Detected columns:</span>{" "}
            {mappingEntries.map(([field, header], i) => (
              <span key={field}>
                {i > 0 && ", "}
                <span className="text-foreground">{field}</span> ← {header}
              </span>
            ))}
          </div>
        )}
      </div>

      {preview.warnings.length > 0 && (
        <div className="space-y-1 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-xs text-warning">
          {preview.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "New trades", value: preview.trades.length },
          { label: "New executions", value: preview.newExecutionCount },
          { label: "Duplicates skipped", value: preview.duplicateExecutionCount + preview.duplicateTransactionCount },
          { label: "Invalid rows", value: preview.rejectedRowCount },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border px-3 py-2">
            <div className="text-lg font-semibold tabular-nums">{s.value}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border px-3.5 py-2.5 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Expected balance change</span>
          <span className={balanceDelta > 0 ? "font-medium text-success" : balanceDelta < 0 ? "font-medium text-danger" : "font-medium"}>
            {formatSignedCurrency(balanceDelta)}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>Fees &amp; commissions in these executions</span>
          <span>{formatCurrency(fees)}</span>
        </div>
      </div>

      {preview.trades.length > 0 && (
        <Section title="Reconstructed trades" count={preview.trades.length}>
          <div className="space-y-1.5">
            {preview.trades.map((t, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border border-border px-3.5 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t.instrument}</span>
                  <Badge variant="outline">{t.direction}</Badge>
                  <span className="text-xs text-muted-foreground">{t.status}</span>
                </div>
                <div className="text-right">
                  <div className={num(t.netPnl) >= 0 ? "font-medium text-success" : "font-medium text-danger"}>
                    {formatSignedCurrency(num(t.netPnl))}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t.entryCount} in · {t.exitCount} out
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {preview.newPayouts.length > 0 && (
        <Section title="Payouts / withdrawals" count={preview.newPayouts.length}>
          {profitSplitInput && (
            <div className="mb-2 space-y-1.5 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5">
              <div className="flex items-center gap-2 text-xs text-warning">
                <AlertTriangle className="size-3.5 shrink-0" />
                This account has no profit split configured. Set the percentage that applies to these payouts — it&apos;s
                saved on each payout and won&apos;t change if you adjust the account later.
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground" htmlFor="import-profit-split">
                  Profit split %
                </label>
                <Input
                  id="import-profit-split"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  className="h-8 w-24"
                  value={profitSplitInput.value}
                  onChange={(e) => profitSplitInput.onChange(e.target.value)}
                  placeholder="e.g. 80"
                />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            {preview.newPayouts.map((row) => (
              <PayoutRow key={row.dedupeKey} row={row} override={overrides[row.dedupeKey]} onOverride={onOverride} />
            ))}
          </div>
        </Section>
      )}

      {preview.ignoredTransactions.length > 0 && (
        <Section title="Deposits, fees & other cash events (posted to the balance, not payouts)" count={preview.ignoredTransactions.length}>
          <div className="space-y-1.5">
            {preview.ignoredTransactions.map((row) => (
              <PayoutRow key={row.dedupeKey} row={row} override={overrides[row.dedupeKey]} onOverride={onOverride} />
            ))}
          </div>
        </Section>
      )}

      {preview.invalidRows.length > 0 && (
        <Section title="Invalid rows (skipped)" count={preview.invalidRows.length}>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
            {preview.invalidRows.map((r) => (
              <li key={r.rowIndex}>
                Row {r.rowIndex + 1}: {r.message}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
