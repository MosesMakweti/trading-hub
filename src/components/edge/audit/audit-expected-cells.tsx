"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Radio, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { createExpectedTradeAction, deleteExpectedTradeAction, updateExpectedTradeAction } from "@/actions/trade-audit.actions";
import { MISS_REASON_LABEL, WEAKNESS_LABEL } from "@/domain/trade-audit/labels";
import { AUDIT_WEAKNESSES, MISS_REASONS, type AuditTradeDTO, type ExpectedTradeDTO, type LiveMissedOpportunityDTO, type MissReasonValue } from "@/types/trade-audit";
import { fmtPrice, newClientKey, useAudit } from "@/components/edge/audit/audit-context";
import { AutosaveText, ChipGroup } from "@/components/edge/audit/audit-fields";
import { AuditEvidenceGallery } from "@/components/edge/audit/audit-evidence-gallery";
import { DirectionBadge } from "@/components/edge/audit/audit-trade-cells";

function PlanFacts({ entry, stop, target, risk }: { entry: number | null; stop: number | null; target: number | null; risk?: number | null }) {
  const rr = entry != null && stop != null && target != null && entry !== stop ? Math.abs(target - entry) / Math.abs(entry - stop) : null;
  return (
    <dl className="grid grid-cols-4 gap-x-3 rounded-lg bg-muted/40 p-2 text-xs">
      {[
        ["Entry", fmtPrice(entry)],
        ["Stop", fmtPrice(stop)],
        ["Target", fmtPrice(target)],
        risk !== undefined ? ["Risk", risk == null ? "—" : `${risk}%`] : ["Planned R", rr == null ? "—" : `${rr.toFixed(2)}R`],
      ].map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
          <dd className={cn("truncate font-mono tabular-nums", value === "—" && "text-muted-foreground/60")}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** LEFT cell for a decision row with no actual trade. When the missed setup
 *  is paired with a trade ("should have taken this instead"), says so. */
export function NotTakenCell({ insteadOf }: { insteadOf?: AuditTradeDTO | null }) {
  return (
    <div className="flex h-full min-h-16 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-border px-3 text-center text-xs text-muted-foreground">
      <span>No trade taken on this setup</span>
      {insteadOf && (
        <span>
          Took <span className="font-medium text-foreground">{tradeOptionLabel(insteadOf)}</span> instead (above)
        </span>
      )}
    </div>
  );
}

export function tradeOptionLabel(t: Pick<AuditTradeDTO, "tradeNumber" | "assetSymbol" | "direction" | "entryTime">): string {
  return `${t.tradeNumber != null ? `#${t.tradeNumber} ` : ""}${t.assetSymbol} ${t.direction === "LONG" ? "long" : "short"}${t.entryTime ? ` ${t.entryTime}` : ""}`;
}

function StrategySelect({ id, value, onChange, disabled }: { id: string; value: string | null; onChange: (next: string | null) => void; disabled?: boolean }) {
  const { strategies } = useAudit();
  if (strategies.length === 0) return null;
  return (
    <select id={id} aria-label="Strategy" disabled={disabled} className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">No strategy</option>
      {strategies.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

/** RIGHT cell — a missed valid setup recorded live, during the session (read-only here). */
export function LiveMissedCell({ opportunity }: { opportunity: LiveMissedOpportunityDTO }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Missed valid setup</span>
        <span className="inline-flex items-center gap-1 rounded border border-success/30 bg-success/10 px-1.5 py-px text-[10px] font-medium text-success">
          <Radio className="size-2.5" /> Recorded during session
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold">{opportunity.assetSymbol}</span>
        <DirectionBadge direction={opportunity.direction} />
        {opportunity.strategyName && <span className="text-xs text-muted-foreground">{opportunity.strategyName}</span>}
      </div>
      <PlanFacts entry={opportunity.plannedEntry} stop={opportunity.plannedStopLoss} target={opportunity.plannedTarget} />
      {(opportunity.missReason || opportunity.missNote) && (
        <p className="text-xs">
          <span className="text-muted-foreground">Why missed: </span>
          {opportunity.missReason ? MISS_REASON_LABEL[opportunity.missReason] : null}
          {opportunity.missNote ? ` — ${opportunity.missNote}` : null}
        </p>
      )}
      <AuditEvidenceGallery images={opportunity.images} compact />
    </div>
  );
}

/** RIGHT cell — a trade the trader SHOULD have taken, recorded in review (editable while open). */
export function ExpectedTradeCell({ expected, dayTrades }: { expected: ExpectedTradeDTO; dayTrades: AuditTradeDTO[] }) {
  const router = useRouter();
  const { locked } = useAudit();
  const [linkedTradeId, setLinkedTradeId] = useState<string | null>(expected.linkedTradeId);
  const [strategyId, setStrategyId] = useState<string | null>(expected.strategyId);
  const [weaknesses, setWeaknesses] = useState(expected.weaknesses);
  const [missReason, setMissReason] = useState<MissReasonValue | null>(expected.missReason);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();

  const update = (patch: Record<string, unknown>) => updateExpectedTradeAction({ id: expected.id, patch });
  const saveAndRefresh = async (patch: Record<string, unknown>) => {
    const result = await update(patch);
    if (!result.success) toast.error(result.error);
    else router.refresh();
  };

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Should have taken</span>
        <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">Recorded in review</span>
        {!locked && (
          <Button type="button" variant="ghost" size="icon-xs" className="ml-auto" aria-label="Delete missed trade" onClick={() => setConfirmDelete(true)}>
            <Trash2 />
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold">{expected.assetSymbol}</span>
        <DirectionBadge direction={expected.direction} />
        {expected.strategyName && <span className="text-xs text-muted-foreground">{expected.strategyName}</span>}
        {expected.setupName && <span className="text-xs text-muted-foreground">· {expected.setupName}</span>}
        {expected.timeframe && <span className="text-xs text-muted-foreground">· {expected.timeframe}</span>}
      </div>
      <PlanFacts entry={expected.intendedEntry} stop={expected.stopLoss} target={expected.target} risk={expected.intendedRiskPercent} />

      {!locked && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium" htmlFor={`strategy-${expected.id}`}>
              Strategy
            </label>
            <StrategySelect
              id={`strategy-${expected.id}`}
              value={strategyId}
              onChange={(next) => {
                setStrategyId(next);
                void saveAndRefresh({ strategyId: next });
              }}
            />
          </div>
          {dayTrades.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs font-medium" htmlFor={`pair-${expected.id}`}>
                Should have taken this instead of
              </label>
              <select
                id={`pair-${expected.id}`}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                value={linkedTradeId ?? ""}
                onChange={(e) => {
                  const next = e.target.value || null;
                  setLinkedTradeId(next);
                  void saveAndRefresh({ linkedTradeId: next });
                }}
              >
                <option value="">— (a separate missed setup)</option>
                {dayTrades.map((t) => (
                  <option key={t.id} value={t.id}>
                    {tradeOptionLabel(t)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      <AutosaveText
        label="Why it met my strategy criteria"
        initial={expected.validityReason}
        disabled={locked}
        onSave={async (v) => (v ? update({ validityReason: v }) : { success: false as const, error: "A missed trade needs a reason it was valid." })}
      />

      <div className="space-y-1">
        <label className="text-xs font-medium" htmlFor={`miss-${expected.id}`}>
          Why I missed it
        </label>
        {locked ? (
          <p className="text-sm">{missReason ? MISS_REASON_LABEL[missReason] : "—"}</p>
        ) : (
          <select
            id={`miss-${expected.id}`}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
            value={missReason ?? ""}
            onChange={(e) => {
              const next = (e.target.value || null) as MissReasonValue | null;
              setMissReason(next);
              void saveAndRefresh({ missReason: next });
            }}
          >
            <option value="">Choose…</option>
            {MISS_REASONS.map((r) => (
              <option key={r} value={r}>
                {MISS_REASON_LABEL[r]}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="grid gap-3 border-t border-border pt-3">
        <ChipGroup
          label="Underlying weakness"
          options={AUDIT_WEAKNESSES.map((k) => ({ key: k, label: WEAKNESS_LABEL[k] }))}
          value={weaknesses}
          disabled={locked}
          onChange={(next) => {
            setWeaknesses(next);
            void saveAndRefresh({ weaknesses: next });
          }}
        />
        <AutosaveText label="" placeholder="Why did I miss it? e.g. Hesitated after yesterday's loss." initial={expected.underlyingWeakness} disabled={locked} onSave={(v) => update({ underlyingWeakness: v })} />
        <AutosaveText label="Improvement" placeholder="e.g. Set alerts on the session high/low before London open." initial={expected.improvement} disabled={locked} onSave={(v) => update({ improvement: v })} />
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium">Chart evidence</p>
        <AuditEvidenceGallery images={expected.images} upload={{ kind: "EXPECTED", expectedId: expected.id }} category="SETUP" compact emptyLabel={locked ? "No screenshots." : undefined} />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this missed trade?"
        description="Its review screenshots are deleted too."
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleting}
        onConfirm={() =>
          startDelete(async () => {
            const result = await deleteExpectedTradeAction(expected.id);
            if (!result.success) toast.error(result.error);
            setConfirmDelete(false);
            router.refresh();
          })
        }
      />
    </div>
  );
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));

/**
 * Inline form to record a trade that should have been taken. Asset,
 * direction and a strategy-based reason are required; prices are optional
 * (approximate is fine). One client key per open form makes a double submit
 * harmless.
 */
export function AddExpectedTradeForm({ dateKey, defaultAsset, onDone }: { dateKey: string; defaultAsset?: string; onDone: () => void }) {
  const router = useRouter();
  const { scope } = useAudit();
  const [strategyId, setStrategyId] = useState<string | null>(scope.strategyId);
  const [clientKey] = useState(newClientKey);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ assetSymbol: defaultAsset ?? "", direction: "LONG" as "LONG" | "SHORT", intendedEntry: "", stopLoss: "", target: "", intendedRiskPercent: "", setupName: "", validityReason: "", missReason: "" });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const prices = [form.intendedEntry, form.stopLoss, form.target, form.intendedRiskPercent].map(num);
  const invalidNumber = prices.some((n) => n != null && (!Number.isFinite(n) || n < 0));
  const canSubmit = form.assetSymbol.trim() !== "" && form.validityReason.trim() !== "" && !invalidNumber;

  function submit() {
    startTransition(async () => {
      const result = await createExpectedTradeAction({
        scope,
        dateKey,
        clientKey,
        data: {
          assetSymbol: form.assetSymbol.trim(),
          direction: form.direction,
          intendedEntry: prices[0],
          stopLoss: prices[1],
          target: prices[2],
          intendedRiskPercent: prices[3],
          setupName: form.setupName.trim() || null,
          strategyId,
          validityReason: form.validityReason.trim(),
          missReason: (form.missReason || null) as MissReasonValue | null,
        },
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Missed trade recorded.");
      onDone();
      router.refresh();
    });
  }

  return (
    <form
      className="space-y-2.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) submit();
      }}
    >
      <p className="text-xs font-medium">Record a trade I should have taken</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Input aria-label="Instrument" placeholder="Instrument" value={form.assetSymbol} onChange={set("assetSymbol")} maxLength={32} className="uppercase" required />
        <div className="flex overflow-hidden rounded-lg border border-input" role="radiogroup" aria-label="Direction">
          {(["LONG", "SHORT"] as const).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={form.direction === d} onClick={() => setForm((f) => ({ ...f, direction: d }))} className={cn("flex-1 text-xs font-medium", form.direction === d ? (d === "LONG" ? "bg-success/15 text-success" : "bg-danger/15 text-danger") : "text-muted-foreground")}>
              {d === "LONG" ? "Long" : "Short"}
            </button>
          ))}
        </div>
        <Input aria-label="Setup" placeholder="Setup / model" value={form.setupName} onChange={set("setupName")} maxLength={300} className="col-span-2" />
        <div className="col-span-2 sm:col-span-4">
          <StrategySelect id={`new-strategy-${dateKey}`} value={strategyId} onChange={setStrategyId} />
        </div>
        <Input aria-label="Intended entry" placeholder="Entry" inputMode="decimal" value={form.intendedEntry} onChange={set("intendedEntry")} />
        <Input aria-label="Stop loss" placeholder="Stop loss" inputMode="decimal" value={form.stopLoss} onChange={set("stopLoss")} />
        <Input aria-label="Target" placeholder="Target" inputMode="decimal" value={form.target} onChange={set("target")} />
        <Input aria-label="Intended risk percent" placeholder="Risk %" inputMode="decimal" value={form.intendedRiskPercent} onChange={set("intendedRiskPercent")} />
      </div>
      <Textarea
        aria-label="Why the setup met my strategy criteria"
        placeholder="Why it met my strategy criteria at the time (not because price moved afterwards)…"
        value={form.validityReason}
        onChange={set("validityReason")}
        rows={2}
        className="min-h-0 text-sm"
        maxLength={4000}
        required
      />
      <select aria-label="Why I missed it" className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm" value={form.missReason} onChange={set("missReason")}>
        <option value="">Why I missed it (optional)…</option>
        {MISS_REASONS.map((r) => (
          <option key={r} value={r}>
            {MISS_REASON_LABEL[r]}
          </option>
        ))}
      </select>
      {invalidNumber && <p className="text-[11px] text-danger">Prices and risk must be positive numbers.</p>}
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={!canSubmit || pending}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Add missed trade
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Screenshots can be added once it&apos;s saved.</p>
    </form>
  );
}
