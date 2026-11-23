"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/server/guards";
import { SimError, SimNotFoundError } from "@/server/services/simulation/sim-account.service";
import { BacktestRunNotFoundError, BacktestRunValidationError } from "@/server/services/backtest-run.service";
import * as library from "@/server/services/simulation/session-library.service";

type Fail = { success: false; error: string };
type Ok<T> = { success: true } & T;

function fail(error: unknown, fallback: string): Fail {
  if (error instanceof SimError || error instanceof SimNotFoundError || error instanceof BacktestRunNotFoundError || error instanceof BacktestRunValidationError) {
    return { success: false, error: error.message };
  }
  console.error("[session-library.actions]", error);
  return { success: false, error: fallback };
}

const ref = z.object({ kind: z.enum(["LAB", "PROP", "LEGACY"]), id: z.string().min(1).max(64) });
const parse = <T extends z.ZodType>(schema: T, input: unknown): z.infer<T> | Fail => {
  const p = schema.safeParse(input);
  return p.success ? p.data : { success: false, error: p.error.issues[0]?.message ?? "Invalid input." };
};
const isFail = (v: unknown): v is Fail => typeof v === "object" && v != null && (v as Fail).success === false;

function done() {
  revalidatePath("/backtesting", "layout");
}

export async function renameSessionAction(input: unknown): Promise<Ok<object> | Fail> {
  const user = await requireUser();
  const p = parse(ref.extend({ name: z.string().trim().min(1, "Give it a name.").max(120) }), input);
  if (isFail(p)) return p;
  try {
    await library.renameSession(user.id, p.kind, p.id, p.name);
    done();
    return { success: true };
  } catch (e) {
    return fail(e, "Couldn't rename it.");
  }
}

export async function setSessionArchivedAction(input: unknown): Promise<Ok<object> | Fail> {
  const user = await requireUser();
  const p = parse(ref.extend({ archived: z.boolean() }), input);
  if (isFail(p)) return p;
  try {
    await library.setSessionArchived(user.id, p.kind, p.id, p.archived);
    done();
    return { success: true };
  } catch (e) {
    return fail(e, p.archived ? "Couldn't archive it." : "Couldn't restore it.");
  }
}

export async function duplicateSessionAction(input: unknown): Promise<Ok<{ id: string }> | Fail> {
  const user = await requireUser();
  const p = parse(ref.extend({ name: z.string().trim().max(120).optional() }), input);
  if (isFail(p)) return p;
  if (p.kind !== "LAB") return { success: false, error: "Only Strategy Lab backtests can be duplicated." };
  try {
    const copy = await library.duplicateLabAccount(user.id, p.id, p.name);
    done();
    return { success: true, id: copy.id };
  } catch (e) {
    return fail(e, "Couldn't duplicate it.");
  }
}

export async function sessionDeletionImpactAction(input: unknown): Promise<Ok<{ impact: Awaited<ReturnType<typeof library.deletionImpact>> }> | Fail> {
  const user = await requireUser();
  const p = parse(ref, input);
  if (isFail(p)) return p;
  try {
    return { success: true, impact: await library.deletionImpact(user.id, p.kind, p.id) };
  } catch (e) {
    return fail(e, "Couldn't check what would be deleted.");
  }
}

/**
 * Permanent delete. Ownership, kind and the Prop Firm rule are enforced by
 * the service (the confirmation is only a UI guard). A second request for a
 * session that's already gone answers `gone` — the same answer as for a
 * session that never was the user's, so nothing leaks.
 */
export async function deleteSessionAction(input: unknown): Promise<Ok<object> | (Fail & { gone?: true })> {
  const user = await requireUser();
  const p = parse(ref.extend({ confirm: z.literal(true) }), input);
  if (isFail(p)) return p;
  try {
    await library.deleteSession(user.id, p.kind, p.id);
    done();
    return { success: true };
  } catch (e) {
    if (e instanceof SimNotFoundError || e instanceof BacktestRunNotFoundError) {
      done();
      return { success: false, error: "This session no longer exists — it may already have been deleted.", gone: true };
    }
    return fail(e, "Couldn't delete it — nothing was removed.");
  }
}

const refs = z.array(ref).min(1).max(library.MAX_BULK);

export async function bulkArchiveSessionsAction(input: unknown): Promise<Ok<{ count: number }> | Fail> {
  const user = await requireUser();
  const p = parse(z.object({ refs, archived: z.boolean() }), input);
  if (isFail(p)) return p;
  try {
    const count = await library.bulkSetArchived(user.id, p.refs, p.archived);
    done();
    return { success: true, count };
  } catch (e) {
    return fail(e, p.archived ? "Couldn't archive them — nothing was changed." : "Couldn't restore them — nothing was changed.");
  }
}

export async function bulkDeleteSessionsAction(input: unknown): Promise<Ok<{ count: number }> | Fail> {
  const user = await requireUser();
  const p = parse(z.object({ refs, confirm: z.literal(true) }), input);
  if (isFail(p)) return p;
  try {
    const count = await library.bulkDelete(user.id, p.refs);
    done();
    return { success: true, count };
  } catch (e) {
    return fail(e, "Couldn't delete them.");
  }
}
