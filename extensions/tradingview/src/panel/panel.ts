/**
 * Traditorium TradingView Extension — Step 4 (connection UI), Step 5 (chart
 * card), Step 6 (strategy-aware trade context), Step 7 (trade plan + Save).
 * Side panel UI wiring.
 *
 * Token boundary (§27, unchanged since Step 4): the raw token is never held
 * here beyond the moment it's read out of the connect form's input field
 * and handed to `sendMessage({ type: "CONNECT", token })` — nothing here
 * assigns it to a variable that outlives that one call, logs it, or
 * includes it in the DOM anywhere. `CREATE_TRADE` (Step 7) is no
 * exception: this file builds and sends a `CreateTradeRequest` — which
 * structurally cannot contain a token (see @shared/trade-api.ts) — and the
 * background alone attaches the Bearer header (see
 * test/security-boundary.test.ts).
 *
 * `currentDraft` (Step 6) is NOT a secret and is freely readable/
 * renderable; it exists only so every draft-mutating action has an
 * immediate, synchronous "current value" to apply a pure reducer to,
 * without waiting on a round trip first. Step 7 adds two more local
 * mirrors: `currentChartContext` (so the trade payload can be built without
 * an extra round trip) and `submissionState` (the Save button's own
 * idle/submitting/success/error state — see trade-submission.ts).
 */
import type { ExtensionMessage, StateResponse } from "@shared/messages";
import {
  EMPTY_DRAFT,
  acknowledgeSymbolMismatch,
  addTarget,
  applyPlanSuggestion,
  ensureOriginSymbol,
  removeTarget,
  resetAfterSave,
  selectStrategy,
  setDirection,
  setEntryModel,
  setMediaAssetId,
  setNote,
  setPlannedEntry,
  setPlannedStopLoss,
  setSession,
  startNewIdeaForSymbol,
  toggleConfluence,
  toggleExecution,
  updateTarget,
  type TradeDraftContext,
  type TradeNoteField,
} from "@shared/draft";
import { buildCreateTradePayload } from "@shared/trade-payload";
import { API_BASE_URL } from "@shared/config";
import type { TradingViewChartContext } from "@shared/chart-context";
import type { StrategyConfluence, StrategyReference, StrategyReferenceResult, StrategySummary, TradeDirection } from "@shared/strategy";
import type { CreateTradeResult } from "@shared/trade-api";
import type { CaptureResult } from "@shared/capture-api";
import type { UploadMediaResult } from "@shared/media-api";
import type { AnalyzeScreenshotResult } from "@shared/recognition-api";
import { toPlanSuggestion, type PlanSuggestion } from "@shared/recognition-suggestions";
import { toViewModel } from "./view";
import { createStrategyLoader, type StrategyLoadState } from "./strategy-loader";
import { toStrategyContextViewModel, type ConfluenceRowViewModel } from "./strategy-view";
import { createTradeSubmitter, type SubmissionState } from "./trade-submission";
import { toTradeViewModel, type TargetRowViewModel } from "./trade-view";
import { createScreenshotController, type ScreenshotState } from "./screenshot";
import { createRecognitionController, type RecognitionState } from "./recognition";

function el<T extends HTMLElement>(role: string): T {
  const found = document.querySelector<T>(`[data-role="${role}"]`);
  if (!found) throw new Error(`Missing panel element: ${role}`);
  return found;
}

function sendRaw<T>(message: ExtensionMessage): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

function sendMessage(message: ExtensionMessage): Promise<StateResponse> {
  return sendRaw<StateResponse>(message);
}

function setSection(name: string) {
  for (const section of ["disconnected-view", "connect-form", "connecting-view", "error-view", "connected-view"]) {
    el<HTMLElement>(section).hidden = section !== name;
  }
}

// Step 6/7 — the panel's own local mirror of background state, kept
// current so `renderStrategySection()`/`renderTradeSection()` can repaint
// on a pure draft/loader/submission change (a checkbox click, a keystroke)
// WITHOUT a full GET_STATE round trip each time.
let currentDraft: TradeDraftContext = EMPTY_DRAFT;
let currentStrategies: StrategySummary[] = [];
let currentChartContext: TradingViewChartContext | null = null;
let connected = false;
let tvDetected = false;
let loaderState: StrategyLoadState = { status: "idle" };
let submissionState: SubmissionState = { status: "idle" };
let screenshotState: ScreenshotState = { status: "idle" };
let recognitionState: RecognitionState = { status: "idle" };
let rulesExpanded = false;
// Step 9, Part 6 — defaults to expanded (see panel.html's doc comment on
// why, unlike rulesExpanded, this one doesn't default closed).
let notesExpanded = true;

function currentSymbolDisplay(): string | null {
  return currentChartContext?.symbol?.display ?? null;
}

const strategyLoader = createStrategyLoader(
  (strategyId) => sendRaw<StrategyReferenceResult>({ type: "GET_STRATEGY_REFERENCE", strategyId }),
  (state) => {
    loaderState = state;
    renderStrategySection();
    renderTradeSection(); // §5/§12/§14 — asset compatibility and id->name resolution both depend on the loaded strategy
  },
);

const tradeSubmitter = createTradeSubmitter(
  (payload, idempotencyKey) => sendRaw<CreateTradeResult>({ type: "CREATE_TRADE", payload, idempotencyKey }),
  (state) => {
    submissionState = state;
    if (state.status === "success") {
      // §20 — applyDraft already re-renders both sections; no need to also
      // call renderTradeSection() here (see below).
      void applyDraft(resetAfterSave(currentDraft));
    } else {
      renderTradeSection();
    }
  },
);

const screenshotController = createScreenshotController(
  {
    capture: async () => {
      const result = await sendRaw<CaptureResult>({ type: "CAPTURE_CHART" });
      return result.ok ? { ok: true, dataUrl: result.dataUrl } : { ok: false, message: result.message };
    },
    upload: async (dataUrl) => {
      const result = await sendRaw<UploadMediaResult>({ type: "UPLOAD_CAPTURE", dataUrl, fileName: "chart.png" });
      return result.ok ? { ok: true, mediaAssetId: result.media.id } : { ok: false, message: result.message };
    },
  },
  (state) => {
    screenshotState = state;
    if (state.status === "uploaded") {
      // §21 — the ONLY way `draft.mediaAssetId` is ever set: a confirmed
      // upload response, never optimistically. applyDraft already
      // re-renders every section, including this one.
      void applyDraft(setMediaAssetId(currentDraft, state.mediaAssetId));
    } else {
      renderScreenshotSection();
    }
  },
);

const recognitionController = createRecognitionController(
  async (mediaAssetId) => {
    const result = await sendRaw<AnalyzeScreenshotResult>({ type: "ANALYZE_SCREENSHOT", mediaAssetId });
    return result.ok ? { ok: true, outcome: result.outcome } : { ok: false, message: result.message };
  },
  (state) => {
    recognitionState = state;
    renderScreenshotSection();
  },
);

function confluencesById(): ReadonlyMap<string, Pick<StrategyConfluence, "directionApplicability">> {
  const strategy = loaderState.status === "loaded" ? loaderState.strategy : null;
  return new Map((strategy?.confluences ?? []).map((c) => [c.id, { directionApplicability: c.directionApplicability }]));
}

function currentStrategyReference(): StrategyReference | null {
  return loaderState.status === "loaded" ? loaderState.strategy : null;
}

// Persists the panel's own already-computed next draft. §4/§18 — the
// background applies no business rule here, it only writes to
// chrome.storage.session; every reducer already ran in this file via
// @shared/draft.ts's pure functions. §17 — every draft edit is reported to
// the submitter, which only actually rotates the pending idempotency key if
// the last outcome was a DEFINITIVE failure (see trade-submission.ts).
async function applyDraft(next: TradeDraftContext) {
  tradeSubmitter.notifyDraftEdited();
  currentDraft = next;
  renderStrategySection();
  renderTradeSection();
  renderScreenshotSection();
  renderSymbolWarning();
  await sendRaw<{ ok: boolean }>({ type: "SET_DRAFT", draft: next });
}

function renderConfluenceRow(row: ConfluenceRowViewModel): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "tag-row";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = row.checked;
  checkbox.dataset.confluenceId = row.id;

  const text = document.createElement("span");
  text.className = "tag-row-text";
  const name = document.createElement("span");
  name.className = "tag-row-name";
  name.textContent = row.name;
  const meta = document.createElement("span");
  meta.className = row.mandatory ? "tag-row-meta mandatory" : "tag-row-meta";
  const parts = [row.mandatory ? "Mandatory" : "Optional"];
  if (row.weight != null) parts.push(`Weight ${row.weight}`);
  meta.textContent = parts.join(" · ");

  text.append(name, meta);
  label.append(checkbox, text);
  return label;
}

function renderRowList(containerRole: string, rows: ConfluenceRowViewModel[]) {
  const container = el<HTMLElement>(containerRole);
  container.replaceChildren(...rows.map(renderConfluenceRow));
}

function option(value: string, label: string): HTMLOptionElement {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  return opt;
}

// Builds options via the DOM API rather than innerHTML — session/entry-model
// names and strategy names are the trader's own data, but there's no reason
// to ever interpolate untrusted-looking strings into markup when a plain
// createElement call is just as short.
function renderOptions(select: HTMLSelectElement, values: string[], selected: string | null, placeholder: string) {
  select.replaceChildren(option("", placeholder), ...values.map((v) => option(v, v)));
  select.value = selected ?? "";
}

/**
 * Step 9, Part 8. Shown only when the draft has a locked origin symbol
 * that no longer matches the live chart, AND the trader hasn't already
 * dismissed THIS specific mismatch (see draft.ts's doc comments on
 * `ensureOriginSymbol`/`acknowledgeSymbolMismatch`). `originSymbol` itself
 * — not this banner — is what actually protects submission; this is a
 * heads-up, not the enforcement mechanism.
 */
function renderSymbolWarning() {
  const current = currentSymbolDisplay();
  const origin = currentDraft.originSymbol;
  const show = origin != null && current != null && origin !== current && currentDraft.acknowledgedSymbolMismatch !== current;

  const card = el<HTMLElement>("symbol-warning");
  card.hidden = !show;
  if (!show) return;

  el<HTMLElement>("symbol-warning-text").textContent = `This Trade Idea was started for ${origin}. Current chart is ${current}.`;
  el<HTMLButtonElement>("keep-draft").textContent = `Keep ${origin} Draft`;
  el<HTMLButtonElement>("start-new-idea").textContent = `Start New ${current} Idea`;
}

function renderStrategySection() {
  const vm = toStrategyContextViewModel({ connected, strategies: currentStrategies, draft: currentDraft, loader: loaderState });

  const card = el<HTMLElement>("strategy-card");
  card.hidden = !vm.show;
  if (!vm.show) return;

  const select = el<HTMLSelectElement>("strategy-select");
  if (document.activeElement !== select) {
    select.replaceChildren(option("", "Select a strategy…"), ...vm.strategies.map((s) => option(s.id, s.name)));
    select.value = vm.selectedStrategyId ?? "";
  }

  el<HTMLElement>("strategy-loading").hidden = !vm.loading;
  const loadError = el<HTMLElement>("strategy-load-error");
  loadError.hidden = vm.loadErrorMessage == null;
  loadError.textContent = vm.loadErrorMessage ?? "";

  const detail = el<HTMLElement>("strategy-detail");
  detail.hidden = vm.selectedStrategyId == null;
  if (vm.selectedStrategyId == null) return;

  const isLong = vm.direction === "LONG";
  const isShort = vm.direction === "SHORT";
  el<HTMLButtonElement>("direction-long").dataset.active = String(isLong);
  el<HTMLButtonElement>("direction-long").setAttribute("aria-pressed", String(isLong));
  el<HTMLButtonElement>("direction-short").dataset.active = String(isShort);
  el<HTMLButtonElement>("direction-short").setAttribute("aria-pressed", String(isShort));

  const sessionField = el<HTMLElement>("session-field");
  sessionField.hidden = vm.sessionNames.length === 0;
  if (vm.sessionNames.length > 0) {
    renderOptions(el<HTMLSelectElement>("session-select"), vm.sessionNames, vm.selectedSession, "—");
  }

  const entryModelField = el<HTMLElement>("entry-model-field");
  entryModelField.hidden = vm.entryModels.length === 0;
  if (vm.entryModels.length > 0) {
    renderOptions(el<HTMLSelectElement>("entry-model-select"), vm.entryModels, vm.selectedEntryModel, "—");
  }

  el<HTMLElement>("confluences-field").hidden = vm.confluences.length === 0;
  renderRowList("confluence-list", vm.confluences);

  el<HTMLElement>("execution-field").hidden = vm.execution.length === 0;
  renderRowList("execution-list", vm.execution);

  const rules = el<HTMLElement>("strategy-rules");
  rules.hidden = !vm.rules.show;
  if (vm.rules.show) {
    el<HTMLElement>("rules-content").hidden = !rulesExpanded;
    el<HTMLButtonElement>("toggle-rules").setAttribute("aria-expanded", String(rulesExpanded));
    el<HTMLElement>("rules-framework").textContent =
      vm.rules.frameworkStepCount > 0 ? `Framework — ${vm.rules.frameworkStepCount} steps: ${vm.rules.frameworkSteps.join(", ")}` : "";
    const tm = vm.rules.tradeManagement;
    el<HTMLElement>("rules-trade-management").textContent = tm
      ? [
          tm.maxRiskPercent != null ? `Max risk ${tm.maxRiskPercent}%` : null,
          tm.maxHoldingTime ? `Max hold ${tm.maxHoldingTime}` : null,
          ...tm.customRules,
        ]
          .filter((x): x is string => x != null)
          .join(" · ")
      : "Trade management — not configured.";
  }

  const hints: string[] = [];
  if (vm.validation.strategyRequired) hints.push("Strategy required");
  if (vm.validation.directionRequired) hints.push("Direction required");
  if (vm.validation.entryModelRequired) hints.push("Entry model required");
  if (vm.validation.missingMandatoryConfluenceIds.length > 0) hints.push("Mandatory confluence not selected");
  el<HTMLElement>("validation-hints").textContent = hints.join(" · ");
}

// Step 7. Only patches values in place when the target ROWS themselves
// (their ids, in order) haven't changed — a full rebuild on every render
// would steal focus from whichever target price input the trader is mid-
// keystroke in (the same reason renderOptions/the strategy <select> guard
// against re-touching a focused element).
function renderTargetList(rows: TargetRowViewModel[]) {
  const container = el<HTMLElement>("target-list");
  const existingIds = Array.from(container.children).map((c) => (c as HTMLElement).dataset.targetId);
  const nextIds = rows.map((r) => r.id);
  const sameShape = existingIds.length === nextIds.length && existingIds.every((id, i) => id === nextIds[i]);

  if (!sameShape) {
    container.replaceChildren(...rows.map(renderTargetRow));
    return;
  }

  rows.forEach((row, i) => {
    const rowEl = container.children[i] as HTMLElement;
    const priceInput = rowEl.querySelector<HTMLInputElement>(".target-price-input")!;
    if (document.activeElement !== priceInput) priceInput.value = row.targetPrice;
    rowEl.querySelector<HTMLElement>(".target-label")!.textContent = row.label;
    rowEl.querySelector<HTMLElement>(".target-r-preview")!.textContent = row.rPreviewText ?? "";
  });
}

function renderTargetRow(row: TargetRowViewModel): HTMLElement {
  const div = document.createElement("div");
  div.className = "target-row";
  div.dataset.targetId = row.id;

  const label = document.createElement("span");
  label.className = "target-label";
  label.textContent = row.label;

  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.className = "target-price-input";
  input.value = row.targetPrice;
  input.addEventListener("input", () => {
    void applyDraft(updateTarget(currentDraft, row.id, { targetPrice: input.value }));
  });

  const preview = document.createElement("span");
  preview.className = "target-r-preview";
  preview.textContent = row.rPreviewText ?? "";

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "target-remove";
  remove.textContent = "×";
  remove.setAttribute("aria-label", "Remove target");
  remove.addEventListener("click", () => void applyDraft(removeTarget(currentDraft, row.id)));

  div.append(label, input, preview, remove);
  return div;
}

function setValueUnlessFocused(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  if (document.activeElement !== input) input.value = value;
}

function renderTradeSection() {
  const show = connected && tvDetected;
  const card = el<HTMLElement>("trade-plan-card");
  card.hidden = !show;
  if (!show) return;

  const vm = toTradeViewModel({
    draft: currentDraft,
    chartContext: currentChartContext,
    strategy: currentStrategyReference(),
    submission: submissionState,
    webAppBaseUrl: API_BASE_URL,
  });

  setValueUnlessFocused(el<HTMLInputElement>("entry-input"), vm.plannedEntry);
  setValueUnlessFocused(el<HTMLInputElement>("stop-input"), vm.plannedStopLoss);
  renderTargetList(vm.targets);
  setValueUnlessFocused(el<HTMLTextAreaElement>("market-context-input"), vm.marketContext);
  setValueUnlessFocused(el<HTMLTextAreaElement>("areas-of-interest-input"), vm.areasOfInterest);
  setValueUnlessFocused(el<HTMLTextAreaElement>("reason-for-trade-input"), vm.reasonForTrade);

  const warningsEl = el<HTMLElement>("trade-warnings");
  warningsEl.hidden = vm.warningMessages.length === 0;
  warningsEl.textContent = vm.warningMessages.join(" · ");

  const blockersEl = el<HTMLElement>("trade-blockers");
  const showBlockers = vm.blockerMessages.length > 0 && vm.submission.status !== "success";
  blockersEl.hidden = !showBlockers;
  blockersEl.textContent = vm.blockerMessages.join(" · ");

  const saveBtn = el<HTMLButtonElement>("save-trade");
  saveBtn.disabled = !vm.canSave;
  saveBtn.hidden = vm.submission.status === "success";
  saveBtn.textContent = vm.submission.status === "submitting" ? "Saving…" : "Save Trade Idea";

  el<HTMLElement>("notes-content").hidden = !notesExpanded;
  el<HTMLButtonElement>("toggle-notes").textContent = notesExpanded ? "Notes ▴" : "Notes ▾";
  el<HTMLButtonElement>("toggle-notes").setAttribute("aria-expanded", String(notesExpanded));

  el<HTMLElement>("trade-success").hidden = vm.submission.status !== "success";
  el<HTMLElement>("trade-error").hidden = vm.submission.status !== "error";

  if (vm.submission.status === "success") {
    const s = vm.submission;
    el<HTMLElement>("success-summary").textContent =
      `${s.assetSymbol} · ${s.direction}${s.strategyName ? ` · ${s.strategyName}` : ""} · ${s.targetCount} target${s.targetCount === 1 ? "" : "s"}${s.hasPlanScreenshot ? " · Screenshot attached" : ""}`;
    const warnEl = el<HTMLElement>("success-warnings");
    warnEl.hidden = s.warnings.length === 0;
    warnEl.textContent = s.warnings.length > 0 ? `Saved with warning: ${s.warnings.join(" ")}` : "";
    el<HTMLAnchorElement>("view-in-traditorium").href = s.viewUrl;
  } else if (vm.submission.status === "error") {
    el<HTMLElement>("error-summary").textContent = vm.submission.message;
    const issuesEl = el<HTMLElement>("error-issues");
    issuesEl.replaceChildren(
      ...vm.submission.issues.map((issue) => {
        const li = document.createElement("li");
        li.textContent = `${issue.path}: ${issue.message}`;
        return li;
      }),
    );
  }
}

/** Only the 4 ScreenshotState variants that actually carry an image have a
 *  `dataUrl` — a switch narrows this correctly per-case, which a loose
 *  boolean check on the outside couldn't (TS can't narrow `state` from an
 *  externally-computed boolean). */
function screenshotDataUrl(state: ScreenshotState): string | null {
  switch (state.status) {
    case "captured":
    case "uploading":
    case "uploaded":
    case "upload_error":
      return state.dataUrl;
    default:
      return null;
  }
}

function renderScreenshotSection() {
  const show = connected && tvDetected;
  const card = el<HTMLElement>("screenshot-card");
  card.hidden = !show;
  if (!show) return;

  const state = screenshotState;
  el<HTMLButtonElement>("capture-chart").hidden = !(state.status === "idle" || state.status === "capture_error");
  el<HTMLElement>("screenshot-capturing").hidden = state.status !== "capturing";

  const dataUrl = screenshotDataUrl(state);
  const previewEl = el<HTMLElement>("screenshot-preview");
  previewEl.hidden = dataUrl == null;

  if (dataUrl) {
    el<HTMLImageElement>("screenshot-image").src = dataUrl;

    const uploadBtn = el<HTMLButtonElement>("upload-screenshot");
    uploadBtn.hidden = state.status === "uploading" || state.status === "uploaded";
    uploadBtn.disabled = state.status === "uploading";
    uploadBtn.textContent = state.status === "upload_error" ? "Try Upload Again" : "Upload Screenshot";

    const statusEl = el<HTMLElement>("screenshot-status");
    switch (state.status) {
      case "captured":
        statusEl.textContent = "Not uploaded yet.";
        break;
      case "uploading":
        statusEl.textContent = "Uploading…";
        break;
      case "uploaded":
        statusEl.textContent = "✓ Uploaded";
        break;
      case "upload_error":
        statusEl.textContent = "";
        break;
    }
  }

  const errorEl = el<HTMLElement>("screenshot-error");
  const hasError = state.status === "capture_error" || state.status === "upload_error";
  errorEl.hidden = !hasError;
  if (hasError) errorEl.textContent = state.message;

  // Step 9, Parts 1-4 — recognition, only ever offered once a screenshot
  // is uploaded (a real mediaAssetId to analyze). §2/§3: recognition
  // failure never blocks manual Quick Add — the Trade Plan card below is
  // fully usable regardless of anything happening in this section.
  const uploaded = state.status === "uploaded";
  el<HTMLElement>("analyze-idle").hidden = !(uploaded && recognitionState.status === "idle");
  el<HTMLElement>("recognition-analyzing").hidden = !(uploaded && recognitionState.status === "analyzing");

  const recognitionErrorEl = el<HTMLElement>("recognition-error");
  recognitionErrorEl.hidden = !(uploaded && recognitionState.status === "error");
  if (uploaded && recognitionState.status === "error") recognitionErrorEl.textContent = recognitionState.message;

  const resultEl = el<HTMLElement>("recognition-result");
  resultEl.hidden = !(uploaded && recognitionState.status === "analyzed");
  if (uploaded && recognitionState.status === "analyzed") renderRecognitionResult(toPlanSuggestion(recognitionState.outcome));
}

function recognitionFieldRow(label: string, value: string | null): [HTMLElement, HTMLElement] {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  if (value != null) {
    dd.textContent = value;
  } else {
    dd.textContent = "Not detected";
    dd.className = "not-detected";
  }
  return [dt, dd];
}

function buildRecognitionFieldRows(suggestion: PlanSuggestion): HTMLElement[] {
  const rows: HTMLElement[] = [];
  const push = (label: string, value: string | null) => rows.push(...recognitionFieldRow(label, value));
  push("Entry", suggestion.entry);
  push("Stop", suggestion.stopLoss);
  if (suggestion.targets.length === 0) {
    push("Targets", null);
  } else {
    for (const target of suggestion.targets) push(`TP${target.order}`, target.price);
  }
  return rows;
}

/**
 * Step 9, Part 4 — compares the suggestion's OWN symbol/timeframe/direction
 * against the trusted browser context (chart symbol/timeframe) and the
 * trader's own already-selected direction. Purely informational — nothing
 * here is ever applied; "Apply Suggestions" only ever touches plan prices/
 * targets (@shared/draft.ts::applyPlanSuggestion), never symbol/timeframe/
 * direction, so there's nothing for this text to protect against beyond
 * making the trader aware.
 */
function describeContextConflict(suggestion: PlanSuggestion): string | null {
  const parts: string[] = [];
  const currentSymbol = currentSymbolDisplay();
  if (suggestion.symbol && currentSymbol && suggestion.symbol !== currentSymbol) {
    parts.push(`symbol ${suggestion.symbol} (chart shows ${currentSymbol})`);
  }
  const currentTimeframe = currentChartContext?.timeframe ?? null;
  if (suggestion.timeframe && currentTimeframe && suggestion.timeframe !== currentTimeframe) {
    parts.push(`timeframe ${suggestion.timeframe} (chart shows ${currentTimeframe})`);
  }
  if (suggestion.direction && currentDraft.direction && suggestion.direction !== currentDraft.direction) {
    parts.push(`direction ${suggestion.direction} (you selected ${currentDraft.direction})`);
  }
  if (parts.length === 0) return null;
  return `Recognition detected a different ${parts.join(", ")} — your chart/selection is kept; Apply only updates the plan prices/targets below.`;
}

function renderRecognitionResult(suggestion: PlanSuggestion) {
  el<HTMLElement>("recognition-empty").hidden = !suggestion.isEmpty;

  const fieldsEl = el<HTMLElement>("recognition-fields");
  fieldsEl.hidden = suggestion.isEmpty;
  if (!suggestion.isEmpty) fieldsEl.replaceChildren(...buildRecognitionFieldRows(suggestion));

  const conflictText = describeContextConflict(suggestion);
  const conflictEl = el<HTMLElement>("recognition-context-conflict");
  conflictEl.hidden = conflictText == null;
  conflictEl.textContent = conflictText ?? "";

  // §3 — "if the trader already entered values manually, make the
  // replacement explicit." A visible warning line, not a second confirm
  // dialog — the trader has already seen this before clicking Apply.
  const hasExistingPlanValues =
    currentDraft.plannedEntry.trim().length > 0 || currentDraft.plannedStopLoss.trim().length > 0 || currentDraft.plannedTargets.length > 0;
  el<HTMLElement>("recognition-overwrite-warning").hidden = !hasExistingPlanValues;

  el<HTMLButtonElement>("apply-suggestions").hidden = suggestion.isEmpty;
}

function render(state: StateResponse) {
  const vm = toViewModel(state);

  el<HTMLElement>("tv-dot").dataset.state = vm.tvOn ? "on" : "off";
  el<HTMLElement>("tv-label").textContent = vm.tvLabel;

  const connRow = el<HTMLElement>("conn-row");
  connRow.hidden = !vm.showConnRow;
  el<HTMLElement>("conn-dot").dataset.state = vm.connState;
  el<HTMLElement>("conn-label").textContent = vm.connLabel;

  el<HTMLElement>("chart-card").hidden = !vm.chart.show;
  el<HTMLElement>("chart-values").hidden = vm.chart.unavailableLabel != null;
  el<HTMLElement>("chart-symbol").textContent = vm.chart.symbolText ?? "";
  el<HTMLElement>("chart-timeframe").textContent = vm.chart.timeframeText ?? "";
  const chartUnavailable = el<HTMLElement>("chart-unavailable");
  chartUnavailable.hidden = vm.chart.unavailableLabel == null;
  chartUnavailable.textContent = vm.chart.unavailableLabel ?? "";

  setSection(
    vm.section === "disconnected"
      ? "disconnected-view"
      : vm.section === "connecting"
        ? "connecting-view"
        : vm.section === "error"
          ? "error-view"
          : "connected-view",
  );

  if (vm.section === "connected") {
    el<HTMLElement>("user-name").textContent = vm.userName;
    el<HTMLElement>("strategy-count").textContent = vm.strategyCountLabel;
  }
  if (vm.section === "error") {
    el<HTMLElement>("error-message").textContent = vm.errorMessage;
  }
  el<HTMLElement>("footer").hidden = !vm.showFooter;

  // Step 6/7 — seed the local mirrors this render's StateResponse carried,
  // then (re)paint the strategy/trade sections from them. `draft` and
  // `chartContext` are always present on a real StateResponse (never
  // absent — @shared/messages.ts), so a fresh panel open picks up whatever
  // the trader had selected last session.
  connected = vm.section === "connected";
  tvDetected = vm.tvOn;
  currentStrategies = vm.strategies;
  currentChartContext = state.chartContext;

  // Step 9, Part 8 — lock the origin symbol in the exact moment this
  // render's draft first has real content and a chart symbol is known.
  // A no-op (returns the SAME object) once already locked, or while the
  // draft is still empty — see draft.ts's ensureOriginSymbol.
  const draftWithOrigin = ensureOriginSymbol(state.draft, currentSymbolDisplay());
  currentDraft = draftWithOrigin;
  if (draftWithOrigin !== state.draft) void applyDraft(draftWithOrigin); // persists + re-renders everything, including below

  if (currentDraft.strategyId && loaderState.status === "idle") {
    strategyLoader.request(currentDraft.strategyId);
  }
  renderStrategySection();
  renderTradeSection();
  renderScreenshotSection();
  renderSymbolWarning();
}

async function refresh() {
  render(await sendMessage({ type: "GET_STATE" }));
}

function wireStrategyEvents() {
  el<HTMLSelectElement>("strategy-select").addEventListener("change", (e) => {
    const id = (e.target as HTMLSelectElement).value || null;
    strategyLoader.request(id);
    void applyDraft(selectStrategy(currentDraft, id));
  });

  const setDirectionTo = (direction: TradeDirection) => {
    void applyDraft(setDirection(currentDraft, currentDraft.direction === direction ? null : direction, confluencesById()));
  };
  el<HTMLButtonElement>("direction-long").addEventListener("click", () => setDirectionTo("LONG"));
  el<HTMLButtonElement>("direction-short").addEventListener("click", () => setDirectionTo("SHORT"));

  el<HTMLSelectElement>("session-select").addEventListener("change", (e) => {
    void applyDraft(setSession(currentDraft, (e.target as HTMLSelectElement).value || null));
  });
  el<HTMLSelectElement>("entry-model-select").addEventListener("change", (e) => {
    void applyDraft(setEntryModel(currentDraft, (e.target as HTMLSelectElement).value || null));
  });

  el<HTMLElement>("confluence-list").addEventListener("change", (e) => {
    const id = (e.target as HTMLInputElement).dataset.confluenceId;
    if (id) void applyDraft(toggleConfluence(currentDraft, id));
  });
  el<HTMLElement>("execution-list").addEventListener("change", (e) => {
    const id = (e.target as HTMLInputElement).dataset.confluenceId;
    if (id) void applyDraft(toggleExecution(currentDraft, id));
  });

  el<HTMLButtonElement>("toggle-rules").addEventListener("click", () => {
    rulesExpanded = !rulesExpanded;
    renderStrategySection();
  });
}

function attemptSave() {
  // §14 — always rebuilt from the CURRENT draft/chart/strategy, never a
  // stale value captured earlier — a direction/strategy/id resolution that
  // was valid a minute ago is re-checked fresh on every Save/Try-again
  // click (buildCreateTradePayload has no memory of its own).
  const result = buildCreateTradePayload({ draft: currentDraft, chartContext: currentChartContext, strategy: currentStrategyReference() });
  if (result.payload) void tradeSubmitter.submit(result.payload);
}

function wireTradeEvents() {
  el<HTMLInputElement>("entry-input").addEventListener("input", (e) => {
    void applyDraft(setPlannedEntry(currentDraft, (e.target as HTMLInputElement).value));
  });
  el<HTMLInputElement>("stop-input").addEventListener("input", (e) => {
    void applyDraft(setPlannedStopLoss(currentDraft, (e.target as HTMLInputElement).value));
  });
  el<HTMLButtonElement>("add-target").addEventListener("click", () => void applyDraft(addTarget(currentDraft)));

  el<HTMLButtonElement>("toggle-notes").addEventListener("click", () => {
    notesExpanded = !notesExpanded;
    renderTradeSection();
  });

  const noteFields: [string, TradeNoteField][] = [
    ["market-context-input", "marketContext"],
    ["areas-of-interest-input", "areasOfInterest"],
    ["reason-for-trade-input", "reasonForTrade"],
  ];
  for (const [role, field] of noteFields) {
    el<HTMLTextAreaElement>(role).addEventListener("input", (e) => {
      void applyDraft(setNote(currentDraft, field, (e.target as HTMLTextAreaElement).value));
    });
  }

  el<HTMLButtonElement>("save-trade").addEventListener("click", attemptSave);
  el<HTMLButtonElement>("retry-save").addEventListener("click", attemptSave);

  // §20 — "Add Another": clears the just-saved trade's setup-specific
  // fields (see resetAfterSave's doc comment) and starts a fresh
  // idempotency-key lifecycle for the next logical submission.
  el<HTMLButtonElement>("add-another").addEventListener("click", () => {
    tradeSubmitter.reset();
    void applyDraft(resetAfterSave(currentDraft));
  });
}

/**
 * Step 10 — best-effort, fire-and-forget cleanup of a standalone screenshot
 * the trader is abandoning before it was ever attached to a saved Trade
 * Idea. Deliberately NOT awaited: the local draft has already moved on by
 * the time this is called (see the two call sites below), and a network
 * failure here must never affect the draft (§"Finish Screenshot Lifecycle
 * Cleanup" — "Network cleanup failure must not destroy the trade draft").
 * A 409 ("already attached") is expected and silently fine — the server
 * remains authoritative and simply refuses; this never retries. See
 * background/state.ts::deleteOrphanedMedia for the request-level dedup that
 * keeps a rapid double-click from firing two DELETE requests.
 */
function cleanupOrphanedMedia(mediaAssetId: string) {
  void sendRaw<{ ok: boolean }>({ type: "DELETE_MEDIA", mediaAssetId });
}

// §19/§21 — if the draft already references a previously-uploaded
// screenshot, a fresh capture/retake must clear that reference immediately
// (not wait for the new upload to finish) — otherwise a Save click in the
// window between "Retake" and the new upload completing would silently
// attach the OLD, about-to-be-replaced image. The controller's own
// "uploaded" callback sets a NEW mediaAssetId once the new upload confirms.
// Step 10 — also triggers best-effort server-side deletion of the asset
// being abandoned, now that it's never getting attached to anything.
function clearMediaAssetIdIfSet() {
  const orphanedId = currentDraft.mediaAssetId;
  if (orphanedId == null) return;
  void applyDraft(setMediaAssetId(currentDraft, null));
  cleanupOrphanedMedia(orphanedId);
}

function wireScreenshotEvents() {
  // §13 — the ONLY places capture ever fires: these two explicit clicks.
  el<HTMLButtonElement>("capture-chart").addEventListener("click", () => {
    clearMediaAssetIdIfSet();
    screenshotController.capture();
  });
  el<HTMLButtonElement>("retake-screenshot").addEventListener("click", () => {
    clearMediaAssetIdIfSet();
    screenshotController.retake();
    recognitionController.dismiss(); // any suggestion belonged to the OLD image
  });
  el<HTMLButtonElement>("upload-screenshot").addEventListener("click", () => screenshotController.upload());
  el<HTMLButtonElement>("remove-screenshot").addEventListener("click", () => {
    screenshotController.remove();
    // §20/Step 10 — Remove also clears the draft's reference to an
    // already-uploaded asset AND best-effort deletes it server-side
    // (clearMediaAssetIdIfSet → cleanupOrphanedMedia) — it was never
    // attached to anything, so there's nothing left worth keeping.
    clearMediaAssetIdIfSet();
    recognitionController.dismiss();
  });

  // Step 9, Parts 1-3 — recognition. Analyze only ever runs against the
  // draft's OWN already-uploaded mediaAssetId — never a local, unconfirmed
  // capture (§18).
  el<HTMLButtonElement>("analyze-chart").addEventListener("click", () => {
    if (currentDraft.mediaAssetId) recognitionController.analyze(currentDraft.mediaAssetId);
  });
  el<HTMLButtonElement>("dismiss-suggestions").addEventListener("click", () => recognitionController.dismiss());
  el<HTMLButtonElement>("apply-suggestions").addEventListener("click", () => {
    if (recognitionState.status !== "analyzed") return;
    const suggestion = toPlanSuggestion(recognitionState.outcome);
    void applyDraft(applyPlanSuggestion(currentDraft, suggestion));
    recognitionController.dismiss();
  });
}

function wireSymbolWarningEvents() {
  el<HTMLButtonElement>("keep-draft").addEventListener("click", () => {
    void applyDraft(acknowledgeSymbolMismatch(currentDraft, currentSymbolDisplay()));
  });
  el<HTMLButtonElement>("start-new-idea").addEventListener("click", () => {
    // A genuinely new idea for a different symbol — the old screenshot/
    // recognition/submission state belonged to the PREVIOUS idea too.
    // Step 10 — the old idea's screenshot was never attached to a saved
    // Trade (startNewIdeaForSymbol → resetAfterSave clears mediaAssetId the
    // same way a successful save does), so it's an orphan the moment this
    // draft moves on; capture the id BEFORE the reducer clears it.
    const orphanedMediaAssetId = currentDraft.mediaAssetId;
    screenshotController.remove();
    recognitionController.dismiss();
    tradeSubmitter.reset();
    void applyDraft(startNewIdeaForSymbol(currentDraft, currentSymbolDisplay()));
    if (orphanedMediaAssetId != null) cleanupOrphanedMedia(orphanedMediaAssetId);
  });
}

function wireEvents() {
  el<HTMLButtonElement>("show-connect-form").addEventListener("click", () => setSection("connect-form"));
  el<HTMLButtonElement>("cancel-connect").addEventListener("click", () => setSection("disconnected-view"));

  const submitToken = async () => {
    const input = el<HTMLInputElement>("token-input");
    const token = input.value;
    input.value = ""; // never leave the raw token sitting in the DOM after submit
    setSection("connecting-view");
    render(await sendMessage({ type: "CONNECT", token }));
  };
  el<HTMLButtonElement>("submit-token").addEventListener("click", submitToken);
  el<HTMLInputElement>("token-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitToken();
  });

  el<HTMLButtonElement>("retry-connect").addEventListener("click", () => setSection("connect-form"));

  el<HTMLButtonElement>("disconnect").addEventListener("click", async () => {
    render(await sendMessage({ type: "DISCONNECT" }));
  });

  wireStrategyEvents();
  wireTradeEvents();
  wireScreenshotEvents();
  wireSymbolWarningEvents();

  // Step 9, Part 11 — every "Traditorium → Settings → Integrations" link
  // (disconnected view, connect-form hint, footer) points at the real,
  // existing page (settings/integrations/page.tsx, Part 10) — never a
  // dead/invented URL. `querySelectorAll` since this data-role is
  // deliberately reused by more than one element (the single-element `el`
  // helper only ever finds the first).
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('[data-role="open-settings"]')) {
    anchor.href = `${API_BASE_URL}/settings/integrations`;
  }
}

wireEvents();
void refresh();

// Re-verify whenever the panel regains focus (covers "reopen the panel",
// "switch back to this tab/window" — §15) rather than only once at load.
window.addEventListener("focus", () => void refresh());

// Step 5, §12 — the content script's CHART_CONTEXT_CHANGED broadcast is
// also delivered here directly (per Chrome's own extension-messaging
// model: onMessage fires in every listening context, not just the
// background). The panel does NOT read `message.context` and render it —
// that would mean the panel trusting a value pushed straight from the
// page, bypassing the background. It's used purely as a "something
// changed, ask the background for a fresh authoritative state" trigger,
// so "background owns state" still holds in spirit (see index.ts).
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === "CHART_CONTEXT_CHANGED") void refresh();
});
