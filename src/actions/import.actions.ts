"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { tradeImportFileSchema } from "@/lib/validation/trade-import";
import { importTrades, type ImportSummary } from "@/server/services/import.service";

type ActionResult = { success: true; summary: ImportSummary } | { success: false; error: string };

export async function importTradesFromJson(jsonText: string): Promise<ActionResult> {
  const user = await requireUser();

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch {
    return { success: false, error: "That file isn't valid JSON." };
  }

  const parsed = tradeImportFileSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      success: false,
      error: `Invalid trade data${issue ? ` at ${issue.path.join(".")}: ${issue.message}` : "."}`,
    };
  }

  const summary = await importTrades(user.id, parsed.data);
  revalidatePath("/journal");
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  return { success: true, summary };
}
