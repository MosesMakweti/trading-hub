"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Lock, Sparkles, Trash2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useWorkspaceEditable } from "@/components/journal/workspace/editable-context";
import { PlanScreenshotDropzone } from "@/components/journal/workspace/trade-plan/plan-screenshot-dropzone";
import { PlanAnnotatedImage, type PlanImageLine } from "@/components/journal/workspace/trade-plan/plan-annotated-image";
import { parseSymbol } from "@/domain/trade-plan/instrument-catalog";
import { computeDistance } from "@/domain/trade-plan/distance";
import { computeTargetRMultiples, computeWeightedPlannedR } from "@/domain/trade-plan/planned-rr";
import { validatePlan, hasBlockingIssues, type PlanValidationIssue } from "@/domain/trade-plan/plan-validation";
import {
  confirmPlanAction,
  loadPlanWorkspaceAction,
  removePlanScreenshotAction,
  revisePlanAction,
  runRecognitionAction,
  upsertPlanAnnotationAction,
} from "@/actions/trade-plan.actions";
import { loadMediaAction } from "@/actions/media.actions";
import type { MediaItemDTO } from "@/server/services/media.service";
import type { PlanVersionDTO, PlanWorkspaceDTO } from "@/types/trade-plan";

type DirectionLike = "LONG" | "SHORT";

interface TargetRow {
  key: string;
  targetOrder: number;
  label: string;
  targetPrice: string;
  plannedClosePercent: string;
  managementInstruction: string;
  moveToBreakEven: boolean;
  notes: string;
}

function emptyTarget(order: number): TargetRow {
  return {
    key: `new-${order}-${Math.random().toString(36).slice(2)}`,
    targetOrder: order,
    label: `TP${order}`,
    targetPrice: "",
    plannedClosePercent: "",
    managementInstruction: "",
    moveToBreakEven: false,
    notes: "",
  };
}

/** Entry/stop/target values are instrument PRICES, never dollar amounts —
 *  formatCurrency (a 2-decimal $ formatter meant for account balances/PnL)
 *  would silently round an FX price like 1.08500 to "$1.09" and prepend a
 *  meaningless $ sign. Respects the resolved instrument's own quote
 *  precision when known. */
function formatPrice(value: number, precision: number | null): string {
  const digits = precision ?? (Math.abs(value) >= 100 ? 2 : 5);
  return value.toFixed(digits);
}

const STATUS_LABEL: Record<string, string> = {
  UPLOADED: "Uploaded",
  QUEUED: "Queued for recognition",
  PROCESSING: "Processing",
  RECOGNITION_COMPLETE: "Recognition complete",
  NEEDS_CONFIRMATION: "Needs confirmation",
  CONFIRMED: "Confirmed",
  RECOGNITION_FAILED: "Recognition unavailable",
  MANUALLY_CONFIGURED: "Manually configured",
  LOCKED: "Locked",
};

export function TradePlanSection({
  dateKey,
  tradeId,
  assetSymbol,
  initialDirection,
  tradeUpdatedAt,
}: {
  dateKey: string;
  tradeId: string;
  assetSymbol: string;
  initialDirection: DirectionLike;
  /** The trade's own `updatedAt`, re-read from the server on every
   *  `router.refresh()` (e.g. saving "Actual entry" in Trade Execution).
   *  This component otherwise has no way to know a sibling field's save
   *  just locked its plan — refetching whenever this value changes is what
   *  keeps the plan summary in sync without polling. */
  tradeUpdatedAt: string;
}) {
  const editable = useWorkspaceEditable();
  const router = useRouter();
  const [plan, setPlan] = useState<PlanWorkspaceDTO | null>(null);
  const [beforeImages, setBeforeImages] = useState<MediaItemDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [forceEdit, setForceEdit] = useState(false);
  const [revising, setRevising] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [draggedY, setDraggedY] = useState<Record<string, number>>({});

  const [direction, setDirection] = useState<DirectionLike>(initialDirection);
  const [timeframe, setTimeframe] = useState("");
  const [entry, setEntry] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [targets, setTargets] = useState<TargetRow[]>([emptyTarget(1)]);
  const [editReason, setEditReason] = useState("");

  async function refresh() {
    const [planResult, mediaResult] = await Promise.all([
      loadPlanWorkspaceAction(tradeId),
      loadMediaAction("TRADE", tradeId),
    ]);
    if (planResult.success) {
      setPlan(planResult.data);
      hydrateFormFromPlan(planResult.data);
    }
    setBeforeImages(mediaResult.items.filter((i) => i.category === "BEFORE"));
    setLoading(false);
  }

  function hydrateFormFromPlan(data: PlanWorkspaceDTO) {
    const latestVersion = data.versions[0];
    if (latestVersion) {
      setDirection((latestVersion.direction as DirectionLike) ?? "LONG");
      setTimeframe(latestVersion.timeframe ?? "");
      setEntry(latestVersion.entry != null ? String(latestVersion.entry) : "");
      setStopLoss(latestVersion.stopLoss != null ? String(latestVersion.stopLoss) : "");
    }
    if (data.targets.length > 0) {
      setTargets(
        data.targets.map((t) => ({
          key: t.id,
          targetOrder: t.targetOrder,
          label: t.label,
          targetPrice: String(t.targetPrice),
          plannedClosePercent: t.plannedClosePercent != null ? String(t.plannedClosePercent) : "",
          managementInstruction: t.managementInstruction ?? "",
          moveToBreakEven: t.moveToBreakEven,
          notes: t.notes ?? "",
        })),
      );
    }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      if (active) await refresh();
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeId, tradeUpdatedAt]);

  const spec = useMemo(() => parseSymbol(assetSymbol).spec, [assetSymbol]);

  const parsedTargets = useMemo(
    () =>
      targets
        .filter((t) => t.targetPrice.trim() !== "")
        .map((t) => ({
          targetOrder: t.targetOrder,
          targetPrice: Number(t.targetPrice),
          plannedClosePercent: t.plannedClosePercent.trim() === "" ? null : Number(t.plannedClosePercent),
        })),
    [targets],
  );

  const entryNum = entry.trim() === "" ? null : Number(entry);
  const stopNum = stopLoss.trim() === "" ? null : Number(stopLoss);

  const stopDistance = entryNum != null && stopNum != null ? computeDistance(entryNum, stopNum, spec) : null;
  const targetRs = entryNum != null && stopNum != null ? computeTargetRMultiples(direction, entryNum, stopNum, parsedTargets) : [];
  const weighted = computeWeightedPlannedR(targetRs, parsedTargets);

  const issues: PlanValidationIssue[] = validatePlan({
    direction,
    entry: entryNum,
    stopLoss: stopNum,
    targets: parsedTargets,
    maxDecimalPrecision: spec?.decimalPrecision ?? null,
  });
  const blocking = hasBlockingIssues(issues);

  function updateTarget(key: string, patch: Partial<TargetRow>) {
    setTargets((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  }

  function addTarget() {
    const nextOrder = targets.length > 0 ? Math.max(...targets.map((t) => t.targetOrder)) + 1 : 1;
    setTargets((prev) => [...prev, emptyTarget(nextOrder)]);
  }

  function removeTarget(key: string) {
    setTargets((prev) => {
      const filtered = prev.filter((t) => t.key !== key);
      return filtered.map((t, i) => ({ ...t, targetOrder: i + 1, label: t.label.match(/^TP\d+$/) ? `TP${i + 1}` : t.label }));
    });
  }

  async function handleSave() {
    if (blocking) {
      toast.error("Fix the errors below before confirming the plan.");
      return;
    }
    if (entryNum == null || stopNum == null) return;

    const payload = {
      direction,
      timeframe: timeframe.trim() || null,
      entry: entryNum,
      stopLoss: stopNum,
      targets: parsedTargets.map((t) => {
        const row = targets.find((r) => r.targetOrder === t.targetOrder)!;
        return {
          targetOrder: t.targetOrder,
          label: row.label,
          targetPrice: t.targetPrice,
          plannedClosePercent: t.plannedClosePercent,
          managementInstruction: row.managementInstruction.trim() || null,
          moveToBreakEven: row.moveToBreakEven,
          notes: row.notes.trim() || null,
        };
      }),
    };

    setSaving(true);
    const result = revising
      ? await revisePlanAction(dateKey, tradeId, { ...payload, editReason })
      : await confirmPlanAction(dateKey, tradeId, payload);
    setSaving(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(revising ? "Plan revision saved." : "Plan confirmed.");
    setForceEdit(false);
    setRevising(false);
    setEditReason("");
    await refresh();
    router.refresh();
  }

  async function handleAnalyze() {
    setAnalyzing(true);
    const result = await runRecognitionAction(dateKey, tradeId);
    setAnalyzing(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    if (result.status === "RECOGNITION_FAILED") {
      toast.info(result.error ?? "Recognition unavailable — enter the plan manually below.");
    } else {
      toast.success("Recognition complete — review the detected values below.");
    }
    await refresh();
  }

  async function handleRemoveScreenshot() {
    const result = await removePlanScreenshotAction(dateKey, tradeId);
    setRemoveConfirmOpen(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    await refresh();
  }

  async function saveLineAnnotation(id: string, y: number) {
    const line = imageLines.find((l) => l.id === id);
    if (!line) return;
    await upsertPlanAnnotationAction(dateKey, tradeId, {
      id: line.savedId ?? undefined,
      type: line.annotationType,
      label: line.label,
      confirmedPrice: line.price,
      y,
      color: line.color,
      targetOrder: line.targetOrder ?? null,
    });
    await refresh();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-background/30 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading trade plan…
      </div>
    );
  }

  const isLocked = plan?.isLocked ?? false;
  const hasConfirmedPlan = (plan?.versions.length ?? 0) > 0;
  const showForm = editable && !isLocked && (forceEdit || !hasConfirmedPlan);
  const showReviseForm = editable && isLocked && revising;
  const screenshot = plan?.screenshot ?? null;

  // Lines shown on the screenshot: current form values, colored by type —
  // purely local (annotation type + saved id lookup for persistence).
  const imageLines: (PlanImageLine & {
    annotationType: string;
    price: number | null;
    targetOrder: number | null;
    savedId?: string;
  })[] = [];
  if (screenshot && (showForm || showReviseForm)) {
    const savedByKey = new Map(screenshot.annotations.map((a) => [`${a.type}:${a.targetOrder ?? 0}`, a]));
    const entrySaved = savedByKey.get("ENTRY:0");
    imageLines.push({
      id: "entry",
      annotationType: "ENTRY",
      label: "Entry",
      color: "var(--color-primary)",
      y: entrySaved?.y ?? 0.5,
      price: entryNum,
      targetOrder: null,
      savedId: entrySaved?.id,
      active: activeLineId === "entry",
    });
    const stopSaved = savedByKey.get("STOP_LOSS:0");
    imageLines.push({
      id: "stop",
      annotationType: "STOP_LOSS",
      label: "Stop",
      color: "var(--color-danger)",
      y: stopSaved?.y ?? (direction === "LONG" ? 0.7 : 0.3),
      price: stopNum,
      targetOrder: null,
      savedId: stopSaved?.id,
      active: activeLineId === "stop",
    });
    targets.forEach((t, i) => {
      const saved = savedByKey.get(`TARGET:${t.targetOrder}`);
      imageLines.push({
        id: `target-${t.key}`,
        annotationType: "TARGET",
        label: t.label,
        color: "var(--color-success)",
        y: saved?.y ?? (direction === "LONG" ? 0.3 - i * 0.05 : 0.7 + i * 0.05),
        price: t.targetPrice.trim() === "" ? null : Number(t.targetPrice),
        targetOrder: t.targetOrder,
        savedId: saved?.id,
        active: activeLineId === `target-${t.key}`,
      });
    });
  }

  // Visual-only while dragging — persisted on drag end via saveLineAnnotation.
  function handleLineDrag(id: string, y: number) {
    setDraggedY((prev) => ({ ...prev, [id]: y }));
  }
  const linesWithDrag = imageLines.map((l) => ({ ...l, y: draggedY[l.id] ?? l.y }));

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background/30 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground">TradingView Trade Plan</div>
        {screenshot && (
          <Badge variant={screenshot.status === "LOCKED" ? "outline" : screenshot.status === "CONFIRMED" ? "success" : "secondary"}>
            {screenshot.status === "LOCKED" && <Lock className="size-3" />}
            {STATUS_LABEL[screenshot.status] ?? screenshot.status}
          </Badge>
        )}
      </div>

      {!screenshot && editable && !hasConfirmedPlan && (
        <>
          <PlanScreenshotDropzone dateKey={dateKey} tradeId={tradeId} existingBeforeImages={beforeImages} onAttached={refresh} />
          <div className="text-center">
            <Button type="button" variant="ghost" size="sm" onClick={() => setForceEdit(true)}>
              Skip — plan without a screenshot
            </Button>
          </div>
        </>
      )}

      {screenshot && (
        <div className="space-y-2">
          <PlanAnnotatedImage
            imageUrl={screenshot.imageUrl}
            alt="TradingView plan screenshot"
            lines={linesWithDrag}
            editable={editable && !isLocked && (showForm || showReviseForm)}
            onLineDrag={handleLineDrag}
            onLineDragEnd={(id) => saveLineAnnotation(id, draggedY[id] ?? imageLines.find((l) => l.id === id)?.y ?? 0.5)}
          />
          {editable && !isLocked && (showForm || showReviseForm) && (
            <div className="flex flex-wrap items-center gap-2">
              {screenshot.status !== "CONFIRMED" && screenshot.status !== "LOCKED" && (
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={handleAnalyze} disabled={analyzing}>
                  {analyzing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  Analyze screenshot
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-danger" onClick={() => setRemoveConfirmOpen(true)}>
                <Trash2 className="size-3.5" />
                Remove screenshot
              </Button>
            </div>
          )}
          {screenshot.recognitionError && (
            <div className="flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="size-3.5 shrink-0" />
              {screenshot.recognitionError}
            </div>
          )}
        </div>
      )}

      {(showForm || showReviseForm) && (
        <div className="space-y-3 rounded-lg border border-border bg-background/40 p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Direction</label>
              <Select items={{ LONG: "Long", SHORT: "Short" }} value={direction} onValueChange={(v) => v && setDirection(v as DirectionLike)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="LONG">Long</SelectItem>
                  <SelectItem value="SHORT">Short</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Timeframe</label>
              <Input placeholder="15m" value={timeframe} onChange={(e) => setTimeframe(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Planned entry</label>
              <Input type="number" step="any" value={entry} onFocus={() => setActiveLineId("entry")} onChange={(e) => setEntry(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Planned stop-loss</label>
              <Input type="number" step="any" value={stopLoss} onFocus={() => setActiveLineId("stop")} onChange={(e) => setStopLoss(e.target.value)} />
            </div>
          </div>

          {stopDistance && (
            <p className="text-xs text-muted-foreground">
              Stop distance: <span className="font-medium text-foreground">{stopDistance.distance.toFixed(2)} {stopDistance.unit.toLowerCase()}{stopDistance.distance.toNumber() !== 1 ? "s" : ""}</span>
              {!spec && " (instrument not recognized — showing raw price distance)"}
            </p>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Profit targets</span>
              <Button type="button" variant="outline" size="sm" onClick={addTarget}>Add target</Button>
            </div>
            {targets.map((t) => {
              const r = targetRs.find((x) => x.targetOrder === t.targetOrder);
              const dist = entryNum != null && t.targetPrice.trim() !== "" ? computeDistance(entryNum, Number(t.targetPrice), spec) : null;
              return (
                <div key={t.key} className="space-y-2 rounded-lg border border-border/60 p-2.5">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <Input
                      className="text-xs"
                      value={t.label}
                      onChange={(e) => updateTarget(t.key, { label: e.target.value })}
                      placeholder="Label"
                    />
                    <Input
                      type="number"
                      step="any"
                      className="text-xs"
                      placeholder="Price"
                      value={t.targetPrice}
                      onFocus={() => setActiveLineId(`target-${t.key}`)}
                      onChange={(e) => updateTarget(t.key, { targetPrice: e.target.value })}
                    />
                    <Input
                      type="number"
                      step="any"
                      className="text-xs"
                      placeholder="Close %"
                      value={t.plannedClosePercent}
                      onChange={(e) => updateTarget(t.key, { plannedClosePercent: e.target.value })}
                    />
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {r?.rMultiple != null ? `${r.rMultiple.toNumber() >= 0 ? "+" : ""}${r.rMultiple.toFixed(2)}R` : "—"}
                      {dist && <span>· {dist.distance.toFixed(1)} {dist.unit.toLowerCase()}</span>}
                    </div>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove target" onClick={() => removeTarget(t.key)}>
                      <X />
                    </Button>
                  </div>
                  <Input
                    className="text-xs"
                    placeholder="Management instruction (e.g. move stop to break-even after this fills)"
                    value={t.managementInstruction}
                    onChange={(e) => updateTarget(t.key, { managementInstruction: e.target.value })}
                  />
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
            <span>
              Weighted planned R: <span className="font-medium text-foreground">{weighted.weightedR != null ? `${weighted.weightedR.toFixed(2)}R` : "—"}</span>
            </span>
            <span>
              Allocated: <span className="font-medium text-foreground">{weighted.totalAllocatedPercent.toFixed(0)}%</span>
            </span>
            {weighted.remainingRunnerPercent.greaterThan(0) && (
              <span>Runner: <span className="font-medium text-foreground">{weighted.remainingRunnerPercent.toFixed(0)}%</span></span>
            )}
          </div>

          {issues.length > 0 && (
            <div className="space-y-1">
              {issues.map((issue) => (
                <div
                  key={issue.code}
                  className={`rounded-lg px-3 py-1.5 text-xs ${issue.severity === "error" ? "border border-danger/30 bg-danger/10 text-danger" : "border border-warning/30 bg-warning/10 text-warning"}`}
                >
                  {issue.message}
                </div>
              ))}
            </div>
          )}

          {showReviseForm && (
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Edit reason (required — this plan is locked)</label>
              <Textarea rows={2} value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="Why are you changing a locked plan?" />
            </div>
          )}

          <div className="flex justify-end gap-2">
            {(forceEdit || showReviseForm) && hasConfirmedPlan && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setForceEdit(false);
                  setRevising(false);
                  setEditReason("");
                  if (plan) hydrateFormFromPlan(plan);
                }}
              >
                Cancel
              </Button>
            )}
            <Button type="button" size="sm" onClick={handleSave} disabled={saving || blocking || (showReviseForm && !editReason.trim())}>
              {saving ? "Saving…" : showReviseForm ? "Save revision" : "Confirm plan"}
            </Button>
          </div>
        </div>
      )}

      {!showForm && !showReviseForm && hasConfirmedPlan && plan && (
        <PlanSummaryReadOnly
          plan={plan}
          assetSymbol={assetSymbol}
          editable={editable}
          onEdit={() => setForceEdit(true)}
          onRevise={() => setRevising(true)}
        />
      )}

      <ConfirmDialog
        open={removeConfirmOpen}
        onOpenChange={setRemoveConfirmOpen}
        title="Remove screenshot?"
        description="This removes the screenshot from this trade's plan. The image itself stays in your Before-Trade gallery."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={handleRemoveScreenshot}
      />
    </div>
  );
}

function PlanSummaryReadOnly({
  plan,
  assetSymbol,
  editable,
  onEdit,
  onRevise,
}: {
  plan: PlanWorkspaceDTO;
  assetSymbol: string;
  editable: boolean;
  onEdit: () => void;
  onRevise: () => void;
}) {
  const version = plan.versions[0];
  if (!version) return null;
  const spec = parseSymbol(assetSymbol).spec;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <SummaryField label="Asset" value={assetSymbol} />
        <SummaryField label="Timeframe" value={version.timeframe ?? "—"} />
        <SummaryField label="Direction" value={version.direction ?? "—"} />
        <SummaryField label="Entry" value={version.entry != null ? formatPrice(version.entry, spec?.decimalPrecision ?? null) : "—"} />
        <SummaryField label="Stop-loss" value={version.stopLoss != null ? formatPrice(version.stopLoss, spec?.decimalPrecision ?? null) : "—"} />
        <SummaryField
          label="Stop distance"
          value={version.stopDistance != null ? `${version.stopDistance.toFixed(2)} ${(version.stopDistanceUnit ?? "").toLowerCase()}` : "—"}
        />
        <SummaryField label="Weighted planned R" value={version.weightedPlannedR != null ? `${version.weightedPlannedR.toFixed(2)}R` : "—"} />
        <SummaryField label="Confirmed" value={version.locked ? "Locked" : "Yes"} />
      </div>

      {plan.targets.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-background/40 text-left text-muted-foreground">
                <th className="px-3 py-1.5 font-medium">Target</th>
                <th className="px-3 py-1.5 font-medium text-right">Price</th>
                <th className="px-3 py-1.5 font-medium text-right">Distance</th>
                <th className="px-3 py-1.5 font-medium text-right">R</th>
                <th className="px-3 py-1.5 font-medium text-right">Close %</th>
              </tr>
            </thead>
            <tbody>
              {plan.targets.map((t) => (
                <tr key={t.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-1.5">{t.label}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatPrice(t.targetPrice, spec?.decimalPrecision ?? null)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {t.unitDistance != null ? `${t.unitDistance.toFixed(2)} ${(t.unitType ?? "").toLowerCase()}` : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-success">
                    {t.rMultiple != null ? `+${t.rMultiple.toFixed(2)}R` : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{t.plannedClosePercent != null ? `${t.plannedClosePercent.toFixed(0)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!spec && <p className="text-[11px] text-muted-foreground/70 italic">Instrument not recognized in the catalog — distances shown as raw price.</p>}

      {editable && (
        <div className="flex justify-end">
          {version.locked ? (
            <Button type="button" variant="outline" size="sm" onClick={onRevise}>Revise locked plan</Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={onEdit}>Edit plan</Button>
          )}
        </div>
      )}

      {plan.versions.length > 1 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Version history ({plan.versions.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {plan.versions.map((v) => (
              <VersionHistoryItem key={v.id} version={v} decimalPrecision={spec?.decimalPrecision ?? null} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** One entry in the version history — expands to show EXACTLY what was
 *  confirmed at that version: its own frozen screenshot, its own frozen
 *  annotation lines, and its own frozen target list. Never the trade's
 *  current/live screenshot (spec checkpoint 2 §2 — "Open Version 1 ...
 *  must never display Screenshot B"). */
function VersionHistoryItem({ version, decimalPrecision }: { version: PlanVersionDTO; decimalPrecision: number | null }) {
  const [expanded, setExpanded] = useState(false);
  const lines: PlanImageLine[] = version.annotations.map((a, i) => ({
    id: `${version.id}-${i}`,
    label: a.label,
    color: a.color,
    y: a.y,
  }));

  return (
    <li className="rounded-lg border border-border/60 px-2.5 py-1.5">
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setExpanded((e) => !e)}>
        <span className="font-medium text-foreground">
          v{version.versionNumber} {version.locked && <Lock className="inline size-2.5" />}
        </span>
        <span>{new Date(version.createdAt).toLocaleString()}</span>
      </button>
      {version.editReason && <p className="mt-0.5 text-muted-foreground">{version.editReason}</p>}

      {expanded && (
        <div className="mt-2 space-y-2 border-t border-border/60 pt-2">
          {version.screenshotImageUrl && (
            <PlanAnnotatedImage imageUrl={version.screenshotImageUrl} alt={`Plan screenshot for version ${version.versionNumber}`} lines={lines} editable={false} />
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SummaryField label="Direction" value={version.direction ?? "—"} />
            <SummaryField label="Entry" value={version.entry != null ? formatPrice(version.entry, decimalPrecision) : "—"} />
            <SummaryField label="Stop-loss" value={version.stopLoss != null ? formatPrice(version.stopLoss, decimalPrecision) : "—"} />
            <SummaryField label="Weighted R" value={version.weightedPlannedR != null ? `${version.weightedPlannedR.toFixed(2)}R` : "—"} />
          </div>
          {version.targets.length > 0 && (
            <ul className="space-y-1">
              {version.targets.map((t) => (
                <li key={t.targetOrder} className="flex items-center justify-between text-muted-foreground">
                  <span>{t.label}</span>
                  <span>
                    {formatPrice(t.targetPrice, decimalPrecision)}
                    {t.rMultiple != null && ` · +${t.rMultiple.toFixed(2)}R`}
                    {t.plannedClosePercent != null && ` · ${t.plannedClosePercent.toFixed(0)}%`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}
