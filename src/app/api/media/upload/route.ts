import { NextResponse } from "next/server";
import type { MediaOwnerType } from "@prisma/client";

import { prisma } from "@/server/db";
import { auth } from "@/server/auth";
import { utcDateToKey } from "@/lib/date";
import { getTrade } from "@/server/services/trades.service";
import { assertDayEditable, DayArchivedError } from "@/server/services/trading-day.service";
import { saveMediaFile, deleteMediaFile } from "@/lib/media-storage";
import { resolveRecordScope, WorkspaceAccessError } from "@/server/workspace/action-scope";
import { LIVE_SCOPE, runInWorkspaceScope, type WorkspaceScope } from "@/server/workspace/scope";
import {
  ACCEPTED_DOCUMENT_MIME,
  ACCEPTED_IMAGE_MIME,
  assertOwnsMediaTarget,
  attachMedia,
  countMediaForOwner,
  MAX_ATTACHMENTS_PER_OWNER,
  MAX_FILE_SIZE,
  type MediaItemDTO,
} from "@/server/services/media.service";

export const runtime = "nodejs";

const OWNER_TYPES: MediaOwnerType[] = [
  "TRADE",
  "DAILY_NOTE",
  "STRATEGY",
  "STRATEGY_ENTRY_MODEL",
  "STRATEGY_CHECKLIST_ITEM",
  "STRATEGY_FRAMEWORK_STEP",
  "ARSENAL_CONCEPT",
  "PROP_FIRM_MILESTONE",
  "DAILY_ASSET_ANALYSIS",
];

// Certificates/confirmation evidence accept PDFs too; every other owner type
// stays image-only.
const IMAGE_ONLY = new Set<string>(ACCEPTED_IMAGE_MIME);
const IMAGE_AND_PDF = new Set<string>(ACCEPTED_DOCUMENT_MIME);
function acceptedMimeFor(ownerType: MediaOwnerType): Set<string> {
  return ownerType === "PROP_FIRM_MILESTONE" ? IMAGE_AND_PDF : IMAGE_ONLY;
}

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/**
 * Universal media upload endpoint (Cloudflare R2 backend). The browser posts the
 * file(s) here directly; this route buffers each one and uploads it to the
 * private R2 bucket. Enforces: authenticated user, ownership of the target
 * record, image-only MIME, and the size cap. Only the auth-scoped
 * GET /api/media/[id] route ever serves the stored objects back.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return bad("You must be signed in to upload.", 401);
  const userId = session.user.id;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad("Invalid upload.");
  }

  const ownerType = String(form.get("ownerType") ?? "") as MediaOwnerType;
  const ownerId = String(form.get("ownerId") ?? "");
  const rawCategory = form.get("category");
  const category = typeof rawCategory === "string" && rawCategory.length > 0 ? rawCategory : null;
  const rawCaption = form.get("caption");
  const caption = typeof rawCaption === "string" && rawCaption.length > 0 ? rawCaption : null;
  const rawTimeframe = form.get("timeframe");
  const timeframe = typeof rawTimeframe === "string" && rawTimeframe.length > 0 ? rawTimeframe : null;

  if (!OWNER_TYPES.includes(ownerType) || !ownerId) return bad("Invalid target.");
  // Chart timeframe is required for asset-analysis screenshots so it's always
  // available historically — never left to be guessed later.
  if (ownerType === "DAILY_ASSET_ANALYSIS" && !timeframe) {
    return bad("A timeframe is required for a chart-analysis screenshot.");
  }

  // Backtesting (Stage 3) — a simulated trade/asset analysis lives in its
  // Backtest Run, so the ownership, gallery-cap and archived-day checks (and
  // the attach itself) run in the environment the owner record belongs to.
  let scope: WorkspaceScope = LIVE_SCOPE;
  try {
    if (ownerType === "TRADE") scope = await resolveRecordScope(userId, { trade: ownerId }, "write");
    if (ownerType === "DAILY_ASSET_ANALYSIS") scope = await resolveRecordScope(userId, { analysis: ownerId }, "write");
    if (ownerType === "DAILY_NOTE") scope = await resolveRecordScope(userId, { note: ownerId }, "write");
  } catch (e) {
    if (e instanceof WorkspaceAccessError) return bad(e.message, 403);
    throw e;
  }

  return runInWorkspaceScope(scope, async () => {
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) return bad("No files provided.");
    // Cap files per request (defense-in-depth; the client already limits this).
    if (files.length > MAX_ATTACHMENTS_PER_OWNER) {
      return bad(`Too many files in one upload (max ${MAX_ATTACHMENTS_PER_OWNER}).`);
    }

    const owns = await assertOwnsMediaTarget(userId, ownerType, ownerId);
    if (!owns) return bad("Not found or access denied.", 403);

    // Enforce the per-owner/category attachment cap server-side (not just in the UI).
    const existing = await countMediaForOwner(ownerType, ownerId, category);
    if (existing + files.length > MAX_ATTACHMENTS_PER_OWNER) {
      return bad(`This gallery is full (max ${MAX_ATTACHMENTS_PER_OWNER} images).`);
    }

    // A trade on an archived (read-only) day can't receive new uploads.
    if (ownerType === "TRADE") {
      const trade = await getTrade(userId, ownerId);
      if (trade) {
        try {
          await assertDayEditable(userId, utcDateToKey(trade.tradeDate));
        } catch (e) {
          if (e instanceof DayArchivedError) return bad(e.message, 403);
          throw e;
        }
      }
    }

    // Same rule for an asset analysis on an archived day — resolve its
    // TradingDay's date and gate through the same day-editable check.
    if (ownerType === "DAILY_ASSET_ANALYSIS") {
      const analysis = await prisma.dailyAssetAnalysis.findFirst({
        where: { id: ownerId, userId },
        select: { tradingDay: { select: { date: true } } },
      });
      if (analysis) {
        try {
          await assertDayEditable(userId, utcDateToKey(analysis.tradingDay.date));
        } catch (e) {
          if (e instanceof DayArchivedError) return bad(e.message, 403);
          throw e;
        }
      }
    }

    const accepted = acceptedMimeFor(ownerType);
    const created: MediaItemDTO[] = [];
    for (const file of files) {
      if (!accepted.has(file.type)) return bad(`Unsupported file type: ${file.type || "unknown"}.`);
      if (file.size > MAX_FILE_SIZE) return bad("Image is larger than the 8MB limit.");

      const bytes = Buffer.from(await file.arrayBuffer());
      const storageKey = await saveMediaFile(userId, bytes, file.type);
      try {
        created.push(
          await attachMedia({
            userId,
            ownerType,
            ownerId,
            category,
            storageKey,
            fileName: file.name || "image",
            mimeType: file.type,
            fileSize: file.size,
            caption,
            timeframe,
          }),
        );
      } catch (e) {
        // Owner vanished between the checks — don't leave the written file orphaned.
        await deleteMediaFile(storageKey);
        throw e;
      }
    }

    return NextResponse.json({ items: created });
  });
}
