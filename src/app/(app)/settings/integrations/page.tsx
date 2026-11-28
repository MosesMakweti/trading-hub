import { requireUser } from "@/server/guards";
import { listApiTokens } from "@/server/services/api-tokens.service";
import { listMt5AccountOptions } from "@/server/services/mt5-connector.service";
import { IntegrationsView } from "@/components/settings/integrations-view";
import { FadeIn } from "@/components/shared/motion";

/**
 * TradingView Extension — Step 9, Part 10 (docs/extension-api.md). The
 * web-side counterpart to the extension's Connect flow: lets a trader
 * create/see/revoke their own API tokens without the developer CLI
 * (`scripts/create-dev-api-token.mjs`, which remains for local testing).
 * Reuses `api-tokens.actions.ts`'s existing `createApiTokenAction`/
 * `listApiTokensAction`/`revokeApiTokenAction` verbatim — no second token
 * backend. The initial list is server-rendered via the same
 * `api-tokens.service.ts::listApiTokens` those actions call, matching the
 * pattern `settings/data-management/page.tsx` already uses.
 */
export default async function IntegrationsPage() {
  const user = await requireUser();
  const [tokens, mt5Accounts] = await Promise.all([listApiTokens(user.id), listMt5AccountOptions(user.id)]);

  return (
    <FadeIn className="mx-auto max-w-2xl">
      <IntegrationsView initialTokens={tokens} mt5Accounts={mt5Accounts} />
    </FadeIn>
  );
}
