"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { runLive } from "@/server/workspace/scope";
import * as connectorService from "@/server/services/mt5-connector.service";
import { setTimeConvention } from "@/server/services/mt5-sync.service";
import type { Mt5AccountOptionDTO } from "@/server/services/mt5-connector.service";

/**
 * MT5 Connector (Stage 1) — web-side actions for Settings → Integrations and
 * the read-only Broker History page. Thin: auth, delegate, map errors. None
 * of these create journal entries or touch balances.
 */

type Result<T = object> = ({ success: true } & T) | { success: false; error: string };

function fail(e: unknown, fallback: string): { success: false; error: string } {
  return { success: false, error: e instanceof Error ? e.message : fallback };
}

function revalidate(tradingAccountId?: string) {
  revalidatePath("/settings/integrations");
  if (tradingAccountId) revalidatePath(`/accounts/${tradingAccountId}/broker-history`);
}

export async function listMt5AccountsAction(): Promise<Result<{ accounts: Mt5AccountOptionDTO[] }>> {
  const user = await requireUser();
  try {
    return { success: true, accounts: await connectorService.listMt5AccountOptions(user.id) };
  } catch (e) {
    return fail(e, "Could not load MT5 connections.");
  }
}

export async function generateMt5PairingCodeAction(tradingAccountId: string): Promise<Result<{ code: string; expiresAt: string }>> {
  const user = await requireUser();
  if (typeof tradingAccountId !== "string" || !tradingAccountId) return { success: false, error: "Choose an account." };
  try {
    const { code, expiresAt } = await connectorService.issuePairingCode(user.id, tradingAccountId);
    revalidate(tradingAccountId);
    return { success: true, code, expiresAt: expiresAt.toISOString() };
  } catch (e) {
    return fail(e, "Could not generate a pairing code.");
  }
}

export async function pauseMt5ConnectionAction(connectionId: string): Promise<Result> {
  const user = await requireUser();
  try {
    await connectorService.pauseMt5Connection(user.id, connectionId);
    revalidate();
    return { success: true };
  } catch (e) {
    return fail(e, "Could not pause sync.");
  }
}

export async function resumeMt5ConnectionAction(connectionId: string): Promise<Result> {
  const user = await requireUser();
  try {
    await connectorService.resumeMt5Connection(user.id, connectionId);
    revalidate();
    return { success: true };
  } catch (e) {
    return fail(e, "Could not resume sync.");
  }
}

export async function disconnectMt5ConnectionAction(connectionId: string): Promise<Result> {
  const user = await requireUser();
  try {
    await connectorService.revokeMt5Connection(user.id, connectionId);
    revalidate();
    return { success: true };
  } catch (e) {
    return fail(e, "Could not disconnect.");
  }
}

export async function deleteMt5BrokerHistoryAction(connectionId: string): Promise<Result> {
  const user = await requireUser();
  try {
    await connectorService.deleteMt5BrokerHistory(user.id, connectionId);
    revalidate();
    return { success: true };
  } catch (e) {
    return fail(e, "Could not delete broker history.");
  }
}

export async function setMt5TimeConventionAction(connectionId: string, convention: unknown): Promise<Result<{ updatedDeals: number }>> {
  const user = await requireUser();
  try {
    const { updatedDeals } = await runLive(() => setTimeConvention(user.id, connectionId, convention));
    revalidate();
    return { success: true, updatedDeals };
  } catch (e) {
    return fail(e, "Could not update the server-time convention.");
  }
}
