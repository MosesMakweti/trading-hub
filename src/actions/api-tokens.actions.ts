"use server";

import { requireUser } from "@/server/guards";
import * as apiTokensService from "@/server/services/api-tokens.service";
import type { ApiTokenSummary } from "@/server/services/api-tokens.service";

/**
 * TradingView Extension — Step 2 (docs/extension-api.md). Token issuance for
 * the WEB APP's own authenticated session — a trader must already be logged
 * into Traditorium normally (requireUser()) to mint a token for an external
 * client. This is the real, permanent issuance mechanism (not a throwaway
 * dev shortcut); it just has no dedicated Settings UI yet (Step 3). Until
 * that UI exists, see scripts/create-dev-api-token.mjs for local testing.
 */

type CreateResult =
  | { success: true; rawToken: string; token: ApiTokenSummary }
  | { success: false; error: string };
type ListResult = { success: true; tokens: ApiTokenSummary[] } | { success: false; error: string };
type SimpleResult = { success: true } | { success: false; error: string };

export async function createApiTokenAction(name: string): Promise<CreateResult> {
  const user = await requireUser();
  try {
    const { rawToken, token } = await apiTokensService.createApiToken(user.id, name);
    return { success: true, rawToken, token };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not create token." };
  }
}

export async function listApiTokensAction(): Promise<ListResult> {
  const user = await requireUser();
  const tokens = await apiTokensService.listApiTokens(user.id);
  return { success: true, tokens };
}

export async function revokeApiTokenAction(tokenId: string): Promise<SimpleResult> {
  const user = await requireUser();
  await apiTokensService.revokeApiToken(user.id, tokenId);
  return { success: true };
}
