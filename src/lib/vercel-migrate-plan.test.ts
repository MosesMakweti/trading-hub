import { describe, expect, it } from "vitest";

// The build script's pure decision logic (scripts/vercel-migrate.mjs).
import { neonEndpoint, planMigration } from "../../scripts/lib/migrate-plan.mjs";

/**
 * Build-time migration gate — which database a Vercel build may migrate.
 * Pure (no I/O): every case below is a decision, never a connection.
 */

const PROD_POOLED = "postgresql://u:p@ep-prod-111-pooler.eu-central-1.aws.neon.tech/db?sslmode=require";
const PROD_DIRECT = "postgresql://u:p@ep-prod-111.eu-central-1.aws.neon.tech/db?sslmode=require";
const BRANCH_POOLED = "postgresql://u:p@ep-preview-222-pooler.eu-central-1.aws.neon.tech/db?sslmode=require";
const BRANCH_DIRECT = "postgresql://u:p@ep-preview-222.eu-central-1.aws.neon.tech/db?sslmode=require";

/** The finished Preview setup: own runtime branch + dedicated direct URL + production id. */
const isolatedPreview = {
  VERCEL_ENV: "preview",
  DATABASE_URL: BRANCH_POOLED,
  PREVIEW_DIRECT_URL: BRANCH_DIRECT,
  PRODUCTION_DB_ENDPOINT: "ep-prod-111",
};

describe("neonEndpoint", () => {
  it("is the first host label without -pooler", () => {
    expect([neonEndpoint(PROD_POOLED), neonEndpoint(PROD_DIRECT), neonEndpoint(BRANCH_DIRECT)]).toEqual(["ep-prod-111", "ep-prod-111", "ep-preview-222"]);
  });
});

describe("Production — identical to the original gate", () => {
  it("migrates over DIRECT_URL (never DATABASE_URL)", () => {
    expect(planMigration({ VERCEL_ENV: "production", DIRECT_URL: PROD_DIRECT, DATABASE_URL: PROD_POOLED })).toEqual({
      action: "migrate",
      url: PROD_DIRECT,
      label: "production",
    });
  });

  it("fails with the original messages for a missing or pooled DIRECT_URL", () => {
    expect(planMigration({ VERCEL_ENV: "production", DATABASE_URL: PROD_POOLED })).toEqual({ action: "fail", reason: "DIRECT_URL is not set for Production." });
    expect(planMigration({ VERCEL_ENV: "production", DIRECT_URL: PROD_POOLED })).toEqual({
      action: "fail",
      reason: "DIRECT_URL is a pooled (-pooler) host; use Neon's direct connection.",
    });
  });

  it("is unaffected by any Preview variables", () => {
    const withPreviewVars = { VERCEL_ENV: "production", DIRECT_URL: PROD_DIRECT, PREVIEW_DIRECT_URL: BRANCH_DIRECT, PRODUCTION_DB_ENDPOINT: "ep-other-999" };
    expect(planMigration(withPreviewVars)).toEqual({ action: "migrate", url: PROD_DIRECT, label: "production" });
  });
});

describe("Preview — correctly configured", () => {
  it("migrates the isolated branch over PREVIEW_DIRECT_URL", () => {
    expect(planMigration(isolatedPreview)).toEqual({ action: "migrate", url: BRANCH_DIRECT, label: "preview branch" });
  });
});

describe("Preview — missing configuration", () => {
  it("today's setup (shared DATABASE_URL, nothing Preview-specific) skips, exactly as before, and says what to set", () => {
    const r = planMigration({ VERCEL_ENV: "preview", DATABASE_URL: PROD_POOLED });
    expect(r.action).toBe("skip");
    expect(r.action === "skip" && r.reason).toMatch(/PREVIEW_DIRECT_URL and PRODUCTION_DB_ENDPOINT/);
  });

  it("PREVIEW_DIRECT_URL without PRODUCTION_DB_ENDPOINT fails (production can't be ruled out)", () => {
    expect(planMigration({ ...isolatedPreview, PRODUCTION_DB_ENDPOINT: undefined })).toMatchObject({ action: "fail", reason: expect.stringMatching(/PRODUCTION_DB_ENDPOINT is not/) });
  });

  it("PREVIEW_DIRECT_URL without a Preview DATABASE_URL fails", () => {
    expect(planMigration({ ...isolatedPreview, DATABASE_URL: undefined })).toMatchObject({ action: "fail", reason: expect.stringMatching(/DATABASE_URL is missing/) });
  });

  it("a malformed endpoint id or URL fails with an explanation", () => {
    expect(planMigration({ ...isolatedPreview, PRODUCTION_DB_ENDPOINT: PROD_DIRECT })).toMatchObject({ action: "fail", reason: expect.stringMatching(/endpoint id/) });
    expect(planMigration({ ...isolatedPreview, PREVIEW_DIRECT_URL: "not a url" })).toMatchObject({ action: "fail", reason: expect.stringMatching(/not a valid/) });
  });
});

describe("Preview — pooled-only configuration", () => {
  it("a pooled PREVIEW_DIRECT_URL fails (advisory lock is unsafe through the pooler)", () => {
    expect(planMigration({ ...isolatedPreview, PREVIEW_DIRECT_URL: BRANCH_POOLED })).toMatchObject({ action: "fail", reason: expect.stringMatching(/pooled/) });
  });

  it("a pooled-only Preview (DATABASE_URL, no direct URL) never migrates", () => {
    expect(planMigration({ VERCEL_ENV: "preview", DATABASE_URL: BRANCH_POOLED, PRODUCTION_DB_ENDPOINT: "ep-prod-111" })).toMatchObject({ action: "skip" });
  });
});

describe("Preview — accidental Production URL fallback", () => {
  it("never uses DATABASE_URL or a leaked production DIRECT_URL as the migration target", () => {
    // Production's DIRECT_URL accidentally scoped to Preview: ignored — it is not PREVIEW_DIRECT_URL.
    expect(planMigration({ VERCEL_ENV: "preview", DATABASE_URL: PROD_POOLED, DIRECT_URL: PROD_DIRECT })).toMatchObject({ action: "skip" });
  });

  it("production pasted into PREVIEW_DIRECT_URL fails", () => {
    expect(planMigration({ ...isolatedPreview, DATABASE_URL: BRANCH_POOLED, PREVIEW_DIRECT_URL: PROD_DIRECT })).toMatchObject({
      action: "fail",
      reason: expect.stringMatching(/PREVIEW_DIRECT_URL is the PRODUCTION endpoint/),
    });
  });

  it("Preview runtime still on the shared production DATABASE_URL fails once PRODUCTION_DB_ENDPOINT is known", () => {
    // With or without a branch direct URL: Preview must not run against production.
    expect(planMigration({ ...isolatedPreview, DATABASE_URL: PROD_POOLED })).toMatchObject({ action: "fail", reason: expect.stringMatching(/points at the PRODUCTION database/) });
    expect(planMigration({ VERCEL_ENV: "preview", DATABASE_URL: PROD_POOLED, PRODUCTION_DB_ENDPOINT: "ep-prod-111" })).toMatchObject({ action: "fail" });
  });

  it("runtime and migration URLs on different branches fail", () => {
    const otherBranch = "postgresql://u:p@ep-other-333-pooler.eu-central-1.aws.neon.tech/db";
    expect(planMigration({ ...isolatedPreview, DATABASE_URL: otherBranch })).toMatchObject({ action: "fail", reason: expect.stringMatching(/different Neon endpoints/) });
  });
});

describe("Development, custom environments and local builds — unchanged", () => {
  it("non-production Vercel environments skip; local builds migrate DATABASE_URL", () => {
    expect(planMigration({ VERCEL_ENV: "development", DATABASE_URL: PROD_POOLED, PREVIEW_DIRECT_URL: BRANCH_DIRECT })).toMatchObject({ action: "skip" });
    expect(planMigration({ VERCEL_ENV: "staging", DATABASE_URL: PROD_POOLED })).toMatchObject({ action: "skip" });
    expect(planMigration({ DATABASE_URL: "postgresql://localhost:5432/trading_hub" })).toEqual({ action: "migrate", url: "postgresql://localhost:5432/trading_hub", label: "local" });
  });
});
