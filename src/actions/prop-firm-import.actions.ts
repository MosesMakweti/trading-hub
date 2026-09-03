"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import * as importService from "@/server/services/prop-firm-import.service";
import {
  listMappingTemplates,
  saveMappingTemplate,
  deleteMappingTemplate,
} from "@/server/services/prop-firm-import-mapping.service";
import {
  confirmImportSchema,
  inspectImportFileSchema,
  previewImportSchema,
  rollbackImportBatchSchema,
  saveMappingTemplateSchema,
} from "@/lib/validation/prop-firm-import";
import type { ImportPlatform } from "@/domain/prop-firms/import/types";
import type {
  ConfirmResult,
  ImportFileInspection,
  PreviewSummary,
  RollbackPreview,
} from "@/server/services/prop-firm-import.service";

type ActionResult = { success: true } | { success: false; error: string };

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid input.";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export interface MappingTemplateOption {
  id: string;
  name: string;
  platform: ImportPlatform;
  columnMapping: Record<string, string | undefined>;
}

export async function inspectPropFirmImportFileAction(
  input: unknown,
): Promise<{ success: true; inspection: ImportFileInspection } | { success: false; error: string }> {
  await requireUser();
  const parsed = inspectImportFileSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
  try {
    const inspection = await importService.inspectImportFile(
      parsed.data.fileContentBase64,
      parsed.data.fileName,
      parsed.data.mimeType ?? null,
    );
    return { success: true, inspection };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Couldn't read that file.") };
  }
}

export async function previewPropFirmImportAction(
  input: unknown,
): Promise<{ success: true; preview: PreviewSummary } | { success: false; error: string }> {
  const user = await requireUser();
  const parsed = previewImportSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
  try {
    const preview = await importService.previewImport(user.id, parsed.data);
    return { success: true, preview };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to preview the import.") };
  }
}

export async function confirmPropFirmImportAction(
  input: unknown,
): Promise<{ success: true; result: ConfirmResult } | { success: false; error: string }> {
  const user = await requireUser();
  const parsed = confirmImportSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
  try {
    const result = await importService.confirmImport(user.id, parsed.data);
    revalidatePath("/prop-firms");
    revalidatePath("/dashboard");
    return { success: true, result };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to import the file.") };
  }
}

export async function previewRollbackPropFirmImportAction(
  batchId: string,
): Promise<{ success: true; preview: RollbackPreview } | { success: false; error: string }> {
  const user = await requireUser();
  try {
    const preview = await importService.previewRollback(user.id, batchId);
    return { success: true, preview };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Import batch not found.") };
  }
}

export async function rollbackPropFirmImportBatchAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = rollbackImportBatchSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
  try {
    await importService.rollbackImportBatch(user.id, parsed.data.batchId);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to roll back the import.") };
  }
  revalidatePath("/prop-firms");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function listPropFirmImportMappingTemplatesAction(
  platform?: ImportPlatform,
): Promise<{ success: true; templates: MappingTemplateOption[] } | { success: false; error: string }> {
  const user = await requireUser();
  try {
    const rows = await listMappingTemplates(user.id, platform);
    return {
      success: true,
      templates: rows.map((t) => ({
        id: t.id,
        name: t.name,
        platform: t.platform as ImportPlatform,
        columnMapping: t.columnMapping as Record<string, string | undefined>,
      })),
    };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to load templates.") };
  }
}

export async function savePropFirmImportMappingTemplateAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = saveMappingTemplateSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
  try {
    await saveMappingTemplate(user.id, parsed.data);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save the template.") };
  }
  revalidatePath("/prop-firms");
  return { success: true };
}

export async function deletePropFirmImportMappingTemplateAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await deleteMappingTemplate(user.id, id);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to delete the template.") };
  }
  revalidatePath("/prop-firms");
  return { success: true };
}
