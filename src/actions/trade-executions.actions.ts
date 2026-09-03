"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import * as tradeExecutionsService from "@/server/services/trade-executions.service";
import { createManualAdjustment } from "@/server/services/account-ledger.service";
import { executionAllocationSchema, manualLedgerAdjustmentSchema } from "@/lib/validation/prop-firms";

type ActionResult = { success: true } | { success: false; error: string };

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid input.";
}

// Server actions can only return plain serializable data across the RSC
// boundary — decimal.js Decimal instances silently arrive on the client
// stripped of their methods, so every Decimal is converted to a plain number
// here, at the action edge (matches prop-firms.mapper.ts's `.toNumber()` DTO
// convention for the same reason).
export interface AllocationPreviewDTO {
  plannedRiskAmount: number;
  positionSize:
    | { kind: "computed"; positionSize: number; unit: "LOTS" | "CONTRACTS" }
    | { kind: "insufficient_data"; missing: string[]; explanation: string };
  plannedR: number | null;
  plannedRReason?: string;
  warnings: { code: string; severity: "warn" | "hard_block"; message: string }[];
}

/** No-write preview powering the Account Allocation row's live risk/
 *  position-size/warnings display before the trader confirms adding it. */
export async function previewAllocationAction(
  tradeId: string,
  input: unknown,
): Promise<{ success: true; preview: AllocationPreviewDTO } | { success: false; error: string }> {
  const user = await requireUser();
  const parsed = executionAllocationSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  try {
    const preview = await tradeExecutionsService.previewAllocation(user.id, tradeId, parsed.data);
    return {
      success: true,
      preview: {
        plannedRiskAmount: preview.plannedRiskAmount.toNumber(),
        positionSize:
          preview.positionSize.kind === "computed"
            ? { kind: "computed", positionSize: preview.positionSize.positionSize.toNumber(), unit: preview.positionSize.unit }
            : { kind: "insufficient_data", missing: preview.positionSize.missing, explanation: preview.positionSize.explanation },
        plannedR: preview.plannedR?.toNumber() ?? null,
        plannedRReason: preview.plannedRReason,
        warnings: preview.warnings,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to preview allocation." };
  }
}

export async function upsertExecutionAction(tradeId: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = executionAllocationSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  try {
    await tradeExecutionsService.upsertExecution(user.id, tradeId, parsed.data);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to save the allocation." };
  }
  revalidatePath("/journal");
  revalidatePath("/prop-firms");
  return { success: true };
}

export async function removeExecutionAction(tradeId: string, propFirmAccountId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await tradeExecutionsService.removeExecution(user.id, tradeId, propFirmAccountId);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to remove the allocation." };
  }
  revalidatePath("/journal");
  revalidatePath("/prop-firms");
  return { success: true };
}

export async function createManualLedgerAdjustmentAction(accountId: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = manualLedgerAdjustmentSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  try {
    await createManualAdjustment(user.id, accountId, parsed.data);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to post the adjustment." };
  }
  revalidatePath("/prop-firms");
  return { success: true };
}
