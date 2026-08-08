import { NextResponse } from "next/server";
import type { MediaOwnerType } from "@prisma/client";

import { auth } from "@/server/auth";
import { utcDateToKey } from "@/lib/date";
import { getTrade } from "@/server/services/trades.service";
import { assertDayEditable, DayArchivedError } from "@/server/services/trading-day.service";
import { saveMediaFile, deleteMediaFile } from "@/lib/media-storage";
import {
  ACCEPTED_IMAGE_MIME,
  assertOwnsMediaTarget,
  attachMedia,
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
];

const ACCEPTED = new Set<string>(ACCEPTED_IMAGE_MIME);

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/**
 * Universal media upload endpoint (local filesystem backend). The browser posts
 * the file(s) here directly — no cloud round-trip, so it completes on localhost.
 * Enforces: authenticated user, ownership of the target record, image-only MIME,
 * and the size cap. Files land in the private uploads dir; only the auth-scoped
 * GET /api/media/[id] route ever serves them.
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

  if (!OWNER_TYPES.includes(ownerType) || !ownerId) return bad("Invalid target.");

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return bad("No files provided.");

  const owns = await assertOwnsMediaTarget(userId, ownerType, ownerId);
  if (!owns) return bad("Not found or access denied.", 403);

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

  const created: MediaItemDTO[] = [];
  for (const file of files) {
    if (!ACCEPTED.has(file.type)) return bad(`Unsupported file type: ${file.type || "unknown"}.`);
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
        }),
      );
    } catch (e) {
      // Owner vanished between the checks — don't leave the written file orphaned.
      await deleteMediaFile(storageKey);
      throw e;
    }
  }

  return NextResponse.json({ items: created });
}
