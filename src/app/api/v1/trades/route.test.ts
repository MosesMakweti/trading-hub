import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createApiToken } from "@/server/services/api-tokens.service";
import * as tradesService from "@/server/services/trades.service";
import { tradeSchema } from "@/lib/validation/trades";
import { POST as createTradeRoute } from "./route";
import { DELETE as deleteMediaRoute } from "../media/[mediaAssetId]/route";

/**
 * Real integration tests against the dev Postgres DB — same pattern as the
 * rest of this repo's service tests. TradingView Extension — Step 3
 * (docs/extension-api.md).
 */

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `api-trades-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
}

async function makeStrategy(
  userId: string,
  name: string,
  opts: { confluenceName?: string; confluenceDirection?: "BULLISH" | "BEARISH" | "BOTH"; entryModelName?: string } = {},
) {
  const strategy = await prisma.strategy.create({ data: { userId, name, sortOrder: 0 } });
  if (opts.confluenceName) {
    await prisma.strategyChecklistItem.create({
      data: {
        userId,
        strategyId: strategy.id,
        kind: "CONFLUENCE",
        name: opts.confluenceName,
        weight: 100,
        mandatory: true,
        directionApplicability: opts.confluenceDirection ?? "BOTH",
      },
    });
  }
  if (opts.entryModelName) {
    await prisma.strategyEntryModel.create({ data: { strategyId: strategy.id, name: opts.entryModelName, sortOrder: 0 } });
  }
  return strategy;
}

function tradePayload(overrides: Record<string, unknown> = {}) {
  return {
    assetSymbol: "XAUUSD",
    executionMinutes: 570,
    direction: "LONG",
    higherTimeframeBias: "BULLISH",
    biasConfidencePercent: 80,
    ...overrides,
  };
}

function req(body: unknown, rawToken?: string, idempotencyKey?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (rawToken) headers.authorization = `Bearer ${rawToken}`;
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return new Request("http://localhost/api/v1/trades", { method: "POST", headers, body: JSON.stringify(body) });
}

async function createViaApi(rawToken: string, trade: Record<string, unknown>, extra: Record<string, unknown> = {}, idempotencyKey?: string) {
  const res = await createTradeRoute(req({ trade: tradePayload(trade), ...extra }, rawToken, idempotencyKey));
  const body = await res.json();
  return { res, body };
}

async function makeMediaAsset(userId: string) {
  return prisma.mediaAsset.create({
    data: {
      userId,
      storageKey: `test/${Date.now()}-${Math.random().toString(36).slice(2)}`,
      fileName: "chart.png",
      mimeType: "image/png",
      fileSize: 1024,
      url: "https://example.com/chart.png",
    },
  });
}

async function deleteMediaViaApi(rawToken: string, mediaAssetId: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${rawToken}` };
  const res = await deleteMediaRoute(new Request(`http://localhost/api/v1/media/${mediaAssetId}`, { method: "DELETE", headers }), {
    params: Promise.resolve({ mediaAssetId }),
  });
  return res;
}

describe("POST /api/v1/trades", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  describe("authentication", () => {
    it("401s with no token", async () => {
      const res = await createTradeRoute(req({ trade: tradePayload() }));
      expect(res.status).toBe(401);
    });

    it("401s with an invalid token", async () => {
      const res = await createTradeRoute(req({ trade: tradePayload() }, "td_live_garbage"));
      expect(res.status).toBe(401);
    });

    it("creates a trade with a valid token", async () => {
      const user = await makeUser("auth-valid");
      userIds.push(user.id);
      const { rawToken } = await createApiToken(user.id, "test");

      const { res, body } = await createViaApi(rawToken, {});
      expect(res.status).toBe(201);
      expect(body.trade.assetSymbol).toBe("XAUUSD");
      expect(body.trade.direction).toBe("LONG");

      const stored = await prisma.trade.findUnique({ where: { id: body.trade.id } });
      expect(stored?.userId).toBe(user.id); // the AUTHENTICATED user owns it, never client-supplied
    });

    it("400s on malformed JSON", async () => {
      const user = await makeUser("auth-malformed-json");
      userIds.push(user.id);
      const { rawToken } = await createApiToken(user.id, "test");

      const res = await createTradeRoute(
        new Request("http://localhost/api/v1/trades", {
          method: "POST",
          headers: { authorization: `Bearer ${rawToken}` },
          body: "{not json",
        }),
      );
      expect(res.status).toBe(400);
    });

    it("422s with structured, field-mappable errors for an invalid payload", async () => {
      const user = await makeUser("auth-invalid-payload");
      userIds.push(user.id);
      const { rawToken } = await createApiToken(user.id, "test");

      const res = await createTradeRoute(req({ trade: { assetSymbol: "" } }, rawToken));
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(Array.isArray(body.issues)).toBe(true);
      expect(body.issues.length).toBeGreaterThan(0);
      expect(body.issues[0]).toHaveProperty("path");
      expect(body.issues[0]).toHaveProperty("message");
    });
  });

  describe("user isolation", () => {
    it("User A cannot use User B's strategy — 422, no trade created", async () => {
      const userA = await makeUser("iso-a");
      const userB = await makeUser("iso-b");
      userIds.push(userA.id, userB.id);
      const strategyB = await makeStrategy(userB.id, "B's Strategy");
      const { rawToken: tokenA } = await createApiToken(userA.id, "test");

      const { res, body } = await createViaApi(tokenA, { strategyId: strategyB.id });
      expect(res.status).toBe(422);
      expect(JSON.stringify(body)).not.toContain("B's Strategy");

      const count = await prisma.trade.count({ where: { userId: userA.id } });
      expect(count).toBe(0);
    });

    it("a strategyId belonging to no one (garbage id) is rejected the same way", async () => {
      const user = await makeUser("iso-garbage-strategy");
      userIds.push(user.id);
      const { rawToken } = await createApiToken(user.id, "test");

      const { res } = await createViaApi(rawToken, { strategyId: "does-not-exist" });
      expect(res.status).toBe(422);
    });

    it("User A cannot attach User B's uploaded media to a new trade", async () => {
      const userA = await makeUser("iso-media-a");
      const userB = await makeUser("iso-media-b");
      userIds.push(userA.id, userB.id);
      const { rawToken: tokenA } = await createApiToken(userA.id, "test");

      const bAsset = await prisma.mediaAsset.create({
        data: { userId: userB.id, storageKey: "x", fileName: "x.png", mimeType: "image/png", fileSize: 1, url: "https://example.com/x.png" },
      });

      const { res, body } = await createViaApi(tokenA, {}, { mediaAssetId: bAsset.id });
      // The trade itself still succeeds (media attach is a non-fatal follow-up step);
      // the cross-user attempt must be reported as a warning, never silently succeed.
      expect(res.status).toBe(201);
      expect(body.warnings?.some((w: string) => w.startsWith("mediaAssetId:"))).toBe(true);
      expect(body.trade.hasPlanScreenshot).toBe(false);
    });
  });

  describe("canonical equivalence (the same createTrade() as the web app)", () => {
    it("API-created and directly-service-created trades produce identical scoring for the same input", async () => {
      const user = await makeUser("canonical-equivalence");
      userIds.push(user.id);
      const strategy = await makeStrategy(user.id, "Equivalence Strategy", {
        confluenceName: "Liquidity sweep",
        confluenceDirection: "BOTH",
        entryModelName: "Breaker",
      });
      const { rawToken } = await createApiToken(user.id, "test");

      const sharedTradeInput = tradePayload({
        strategyId: strategy.id,
        selectedConfluences: ["Liquidity sweep"],
        selectedEntryModel: "Breaker",
      });

      // Path 1: exactly what trades.actions.ts::createTrade does after validation
      // — parse through the SAME tradeSchema the route also parses through,
      // then call the SAME service function directly.
      const direct = await tradesService.createTrade(user.id, "2026-12-15", tradeSchema.parse(sharedTradeInput));
      // Path 2: the new external API.
      const { res, body } = await createViaApi(rawToken, {
        strategyId: strategy.id,
        selectedConfluences: ["Liquidity sweep"],
        selectedEntryModel: "Breaker",
      });
      expect(res.status).toBe(201);

      expect(body.trade.confluencePercent).toBe(direct.confluencePercent);
      expect(body.trade.setupScore).toBe(direct.setupScore);
      expect(body.trade.setupValid).toBe(direct.setupValid);
      expect(body.trade.strategyName).toBe(direct.strategyNameSnapshot);
      expect(body.trade.selectedEntryModel).toBe(direct.selectedEntryModel);
    });
  });

  describe("strategy-scoped configuration validation", () => {
    it("an entry model NOT belonging to the selected strategy is silently dropped (existing, shared behavior)", async () => {
      const user = await makeUser("wrong-entry-model");
      userIds.push(user.id);
      const strategy = await makeStrategy(user.id, "Strategy A", { entryModelName: "Breaker" });
      const otherStrategy = await makeStrategy(user.id, "Strategy B", { entryModelName: "FVG Retest" });
      const { rawToken } = await createApiToken(user.id, "test");

      const { res, body } = await createViaApi(rawToken, {
        strategyId: strategy.id,
        selectedEntryModel: "FVG Retest", // belongs to otherStrategy, not strategy
      });
      expect(res.status).toBe(201);
      expect(body.trade.selectedEntryModel).toBeNull();
      void otherStrategy;
    });

    it("a confluence not defined on the strategy contributes nothing to the score", async () => {
      const user = await makeUser("wrong-confluence");
      userIds.push(user.id);
      const strategy = await makeStrategy(user.id, "Strategy", { confluenceName: "Liquidity sweep", confluenceDirection: "BOTH" });
      const { rawToken } = await createApiToken(user.id, "test");

      const { res, body } = await createViaApi(rawToken, {
        strategyId: strategy.id,
        selectedConfluences: ["Not A Real Confluence"],
      });
      expect(res.status).toBe(201);
      expect(body.trade.confluencePercent).toBe(0); // nothing eligible matched
    });

    it("direction-aware confluences: a LONG trade gets no credit for a BEARISH-only confluence", async () => {
      const user = await makeUser("direction-aware");
      userIds.push(user.id);
      const strategy = await makeStrategy(user.id, "Strategy", { confluenceName: "Bearish MSB", confluenceDirection: "BEARISH" });
      const { rawToken } = await createApiToken(user.id, "test");

      const { res, body } = await createViaApi(rawToken, {
        direction: "LONG",
        strategyId: strategy.id,
        selectedConfluences: ["Bearish MSB"],
      });
      expect(res.status).toBe(201);
      // Nothing was eligible for a LONG trade, so the ratio has no denominator.
      expect(body.trade.confluencePercent).toBeNull();
      // setupValid is true here: the mandatory-confluence gate only fires for
      // an ELIGIBLE mandatory confluence that's missing. A bearish-only
      // confluence isn't eligible for a LONG trade at all, so there is
      // nothing eligible to be "missing" — the strategy simply has no
      // applicable mandatory confluence for this direction.
      expect(body.trade.setupValid).toBe(true);
    });

    it("the SAME bearish confluence correctly counts for a SHORT trade", async () => {
      const user = await makeUser("direction-aware-short");
      userIds.push(user.id);
      const strategy = await makeStrategy(user.id, "Strategy", { confluenceName: "Bearish MSB", confluenceDirection: "BEARISH" });
      const { rawToken } = await createApiToken(user.id, "test");

      const { res, body } = await createViaApi(rawToken, {
        direction: "SHORT",
        higherTimeframeBias: "BEARISH",
        strategyId: strategy.id,
        selectedConfluences: ["Bearish MSB"],
      });
      expect(res.status).toBe(201);
      expect(body.trade.confluencePercent).toBe(100);
      expect(body.trade.setupValid).toBe(true);
    });
  });

  describe("planned targets (multi-target, canonical PlannedTarget)", () => {
    it("creates multiple targets, preserves ordering, and computes RR server-side", async () => {
      const user = await makeUser("planned-targets");
      userIds.push(user.id);
      const { rawToken } = await createApiToken(user.id, "test");

      const { res, body } = await createViaApi(
        rawToken,
        { assetSymbol: "XAUUSD", direction: "LONG" },
        {
          plan: {
            timeframe: "15m",
            entry: 1900,
            stopLoss: 1890,
            targets: [
              { targetOrder: 1, label: "TP1", targetPrice: 1910, plannedClosePercent: 50 },
              { targetOrder: 2, label: "TP2", targetPrice: 1930 },
            ],
          },
        },
      );
      expect(res.status).toBe(201);
      expect(body.trade.plannedEntry).toBe(1900);
      expect(body.trade.plannedStopLoss).toBe(1890);
      expect(body.trade.plannedTargets).toHaveLength(2);
      expect(body.trade.plannedTargets.map((t: { targetOrder: number }) => t.targetOrder)).toEqual([1, 2]);
      expect(body.trade.plannedTargets[0].rMultiple).toBeCloseTo(1, 4); // (1910-1900)/(1900-1890)
      expect(body.trade.plannedTargets[1].rMultiple).toBeCloseTo(3, 4); // (1930-1900)/(1900-1890)
      // A client-submitted RR is never trusted — no such field exists in the
      // request; expectedRR is entirely server-derived from entry/stop/targets.
      expect(typeof body.trade.expectedRR).toBe("number");

      const rows = await prisma.plannedTarget.findMany({ where: { tradeId: body.trade.id }, orderBy: { targetOrder: "asc" } });
      expect(rows).toHaveLength(2);
      expect(rows[0].targetPrice.toNumber()).toBe(1910);
      expect(rows[1].targetPrice.toNumber()).toBe(1930);
    });

    it("a blocking plan validation error (stop == entry) is reported as a warning, not a failed trade creation", async () => {
      const user = await makeUser("invalid-plan");
      userIds.push(user.id);
      const { rawToken } = await createApiToken(user.id, "test");

      const { res, body } = await createViaApi(
        rawToken,
        { direction: "LONG" },
        // Zero risk distance (stop == entry) is a blocking "error" issue in
        // domain/trade-plan/plan-validation.ts — validatePlan/hasBlockingIssues
        // make savePlan throw, unlike a merely unusual (warning-only) stop side.
        { plan: { entry: 1900, stopLoss: 1900, targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1910 }] } },
      );
      expect(res.status).toBe(201); // the Trade Idea itself is still created
      expect(body.warnings?.some((w: string) => w.startsWith("plan:"))).toBe(true);
      expect(body.trade.plannedTargets).toHaveLength(0); // the invalid plan was not persisted
    });
  });

  describe("Performance Account", () => {
    it("an API-created trade automatically gets a Performance Account allocation, exactly like a web-created one", async () => {
      const user = await makeUser("performance-account");
      userIds.push(user.id);
      const { rawToken } = await createApiToken(user.id, "test");

      const { res, body } = await createViaApi(rawToken, {});
      expect(res.status).toBe(201);

      const performanceAccount = await prisma.tradingAccount.findFirst({ where: { userId: user.id, kind: "PERFORMANCE" } });
      expect(performanceAccount).not.toBeNull();

      const allocation = await prisma.tradeAccountAllocation.findFirst({
        where: { tradeId: body.trade.id, tradingAccountId: performanceAccount!.id },
      });
      expect(allocation).not.toBeNull();
      expect(allocation?.closingPnlNet).toBeNull(); // not settled yet — never a fabricated 0
    });
  });

  describe("idempotency", () => {
    it("the same user + same key + same payload returns the SAME trade, not a second one", async () => {
      const user = await makeUser("idempotent-replay");
      userIds.push(user.id);
      const { rawToken } = await createApiToken(user.id, "test");
      const key = "idem-key-1";

      const first = await createTradeRoute(req({ trade: tradePayload() }, rawToken, key));
      const firstBody = await first.json();
      expect(first.status).toBe(201);

      const second = await createTradeRoute(req({ trade: tradePayload() }, rawToken, key));
      const secondBody = await second.json();
      expect(second.status).toBe(200);
      expect(secondBody.trade.id).toBe(firstBody.trade.id);
      expect(secondBody.replayed).toBe(true);

      const count = await prisma.trade.count({ where: { userId: user.id } });
      expect(count).toBe(1);
    });

    it("the same key with a DIFFERENT payload is a deterministic 409 conflict, not a second trade", async () => {
      const user = await makeUser("idempotent-conflict");
      userIds.push(user.id);
      const { rawToken } = await createApiToken(user.id, "test");
      const key = "idem-key-2";

      await createTradeRoute(req({ trade: tradePayload({ assetSymbol: "XAUUSD" }) }, rawToken, key));
      const conflict = await createTradeRoute(req({ trade: tradePayload({ assetSymbol: "EURUSD" }) }, rawToken, key));

      expect(conflict.status).toBe(409);
      const count = await prisma.trade.count({ where: { userId: user.id } });
      expect(count).toBe(1);
    });

    it("different users may independently reuse the exact same idempotency key", async () => {
      const userA = await makeUser("idem-cross-a");
      const userB = await makeUser("idem-cross-b");
      userIds.push(userA.id, userB.id);
      const { rawToken: tokenA } = await createApiToken(userA.id, "test");
      const { rawToken: tokenB } = await createApiToken(userB.id, "test");
      const key = "shared-key";

      const resA = await createTradeRoute(req({ trade: tradePayload() }, tokenA, key));
      const resB = await createTradeRoute(req({ trade: tradePayload() }, tokenB, key));
      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);
      const bodyA = await resA.json();
      const bodyB = await resB.json();
      expect(bodyA.trade.id).not.toBe(bodyB.trade.id);
    });

    it("without an Idempotency-Key header, two identical requests create two separate trades", async () => {
      const user = await makeUser("no-idempotency-key");
      userIds.push(user.id);
      const { rawToken } = await createApiToken(user.id, "test");

      await createTradeRoute(req({ trade: tradePayload() }, rawToken));
      await createTradeRoute(req({ trade: tradePayload() }, rawToken));

      const count = await prisma.trade.count({ where: { userId: user.id } });
      expect(count).toBe(2);
    });
  });

  // Release-gate regression — the extension's uploaded MediaAsset was
  // reaching TradePlanScreenshot correctly, but attachPlanScreenshot ran
  // AFTER savePlan, so the immutable TradePlanVersion this endpoint creates
  // was always frozen with screenshotMediaAssetId: null — which is what
  // Traditorium's Before Trade UI actually reads (trade-plan.mapper.ts's
  // toVersionDTO). Live-confirmed against a real saved trade's DB rows
  // before the fix. These tests assert on the DB rows directly, not just
  // the response body, since the bug was invisible in the 201/hasPlanScreenshot
  // signal alone.
  describe("Before Trade screenshot attachment (release-gate regression)", () => {
    it("a valid, owned mediaAssetId becomes the canonical Before Trade screenshot: attached to the trade AND frozen into its TradePlanVersion", async () => {
      const user = await makeUser("screenshot-attach");
      userIds.push(user.id);
      const { rawToken } = await createApiToken(user.id, "test");
      const asset = await makeMediaAsset(user.id);

      const { res, body } = await createViaApi(
        rawToken,
        {},
        {
          plan: { entry: 1900, stopLoss: 1890, targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1910 }] },
          mediaAssetId: asset.id,
        },
      );
      expect(res.status).toBe(201);
      expect(body.warnings).toBeUndefined();
      expect(body.trade.hasPlanScreenshot).toBe(true);

      const screenshot = await prisma.tradePlanScreenshot.findFirst({ where: { tradeId: body.trade.id } });
      expect(screenshot?.mediaAssetId).toBe(asset.id);
      // Promoted out of "UPLOADED" by savePlan finding it already attached —
      // the exact signal that was permanently stuck before this fix.
      expect(screenshot?.status).toBe("CONFIRMED");

      const version = await prisma.tradePlanVersion.findFirst({ where: { tradeId: body.trade.id }, orderBy: { versionNumber: "desc" } });
      expect(version?.screenshotMediaAssetId).toBe(asset.id); // the actual regression
      expect(version?.versionNumber).toBe(1);
    });

    it("without a mediaAssetId, the trade still creates normally with no screenshot (no regression for the common no-screenshot case)", async () => {
      const user = await makeUser("screenshot-none");
      userIds.push(user.id);
      const { rawToken } = await createApiToken(user.id, "test");

      const { res, body } = await createViaApi(
        rawToken,
        {},
        { plan: { entry: 1900, stopLoss: 1890, targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1910 }] } },
      );
      expect(res.status).toBe(201);
      expect(body.trade.hasPlanScreenshot).toBe(false);

      const version = await prisma.tradePlanVersion.findFirst({ where: { tradeId: body.trade.id } });
      expect(version?.screenshotMediaAssetId).toBeNull();
    });

    it("a nonexistent mediaAssetId fails safely: the trade still creates, reported as a warning, no screenshot attached", async () => {
      const user = await makeUser("screenshot-missing");
      userIds.push(user.id);
      const { rawToken } = await createApiToken(user.id, "test");

      const { res, body } = await createViaApi(rawToken, {}, { mediaAssetId: "does-not-exist" });
      expect(res.status).toBe(201);
      expect(body.warnings?.some((w: string) => w.startsWith("mediaAssetId:"))).toBe(true);
      expect(body.trade.hasPlanScreenshot).toBe(false);
    });

    it("the attached asset cannot subsequently be deleted through the standalone DELETE endpoint", async () => {
      const user = await makeUser("screenshot-delete-protection");
      userIds.push(user.id);
      const { rawToken } = await createApiToken(user.id, "test");
      const asset = await makeMediaAsset(user.id);

      const { res, body } = await createViaApi(rawToken, {}, { mediaAssetId: asset.id });
      expect(res.status).toBe(201);
      expect(body.trade.hasPlanScreenshot).toBe(true);

      const deleteRes = await deleteMediaViaApi(rawToken, asset.id);
      expect(deleteRes.status).toBe(409);

      const stillThere = await prisma.mediaAsset.findUnique({ where: { id: asset.id } });
      expect(stillThere).not.toBeNull();
    });

    it("multiple planned targets still work correctly alongside a screenshot attachment (the fix must not regress normal plan creation)", async () => {
      const user = await makeUser("screenshot-plus-targets");
      userIds.push(user.id);
      const { rawToken } = await createApiToken(user.id, "test");
      const asset = await makeMediaAsset(user.id);

      const { res, body } = await createViaApi(
        rawToken,
        { assetSymbol: "XAUUSD", direction: "LONG" },
        {
          plan: {
            entry: 1900,
            stopLoss: 1890,
            targets: [
              { targetOrder: 1, label: "TP1", targetPrice: 1910, plannedClosePercent: 50 },
              { targetOrder: 2, label: "TP2", targetPrice: 1930 },
            ],
          },
          mediaAssetId: asset.id,
        },
      );
      expect(res.status).toBe(201);
      expect(body.trade.plannedTargets).toHaveLength(2);
      expect(body.trade.hasPlanScreenshot).toBe(true);

      const version = await prisma.tradePlanVersion.findFirst({ where: { tradeId: body.trade.id } });
      expect(version?.screenshotMediaAssetId).toBe(asset.id);
    });
  });
});
