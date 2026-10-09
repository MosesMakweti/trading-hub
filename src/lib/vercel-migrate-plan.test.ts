import { describe, expect, it } from "vitest";

// The build script's decision logic (scripts/vercel-migrate.mjs).
import {
  PREVIEW_MARKER_SQL,
  neonEndpoint,
  planMigration,
  verifyPreviewMarker,
} from "../../scripts/lib/migrate-plan.mjs";

/**
 * Build-time migration gate — which database a Vercel build may migrate.
 * planMigration is pure; verifyPreviewMarker is exercised with a fake query.
 */

const PROD_POOLED = "postgresql://u:p@ep-prod-111-pooler.eu-central-1.aws.neon.tech/db?sslmode=require";
const PROD_DIRECT = "postgresql://u:p@ep-prod-111.eu-central-1.aws.neon.tech/db?sslmode=require";
const BRANCH_POOLED = "postgresql://u:p@ep-preview-222-pooler.eu-central-1.aws.neon.tech/db?sslmode=require";
const BRANCH_DIRECT = "postgresql://u:p@ep-preview-222.eu-central-1.aws.neon.tech/db?sslmode=require";

/** The finished Preview setup: own runtime branch + dedicated direct URL + production id. */
const isolatedPreview = {
  VERCEL_ENV: "preview",
  VERCEL_TARGET_ENV: "preview",
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

  it("is unaffected by any Preview variables (no marker check, no endpoint checks)", () => {
    const withPreviewVars = { VERCEL_ENV: "production", DIRECT_URL: PROD_DIRECT, PREVIEW_DIRECT_URL: BRANCH_DIRECT, PRODUCTION_DB_ENDPOINT: "ep-other-999" };
    expect(planMigration(withPreviewVars)).toEqual({ action: "migrate", url: PROD_DIRECT, label: "production" });
  });
});

describe("Preview — valid isolated connection", () => {
  it("plans a migration of the isolated branch over PREVIEW_DIRECT_URL (the marker is still required)", () => {
    expect(planMigration(isolatedPreview)).toEqual({ action: "migrate", url: BRANCH_DIRECT, label: "preview branch" });
    expect(planMigration({ ...isolatedPreview, VERCEL_TARGET_ENV: undefined })).toMatchObject({ action: "migrate" });
  });
});

describe("Preview — missing configuration", () => {
  it("today's setup (shared DATABASE_URL, nothing Preview-specific) skips and says what to set", () => {
    const r = planMigration({ VERCEL_ENV: "preview", DATABASE_URL: PROD_POOLED });
    expect(r.action).toBe("skip");
    expect(r.action === "skip" && r.reason).toMatch(/PREVIEW_DIRECT_URL and PRODUCTION_DB_ENDPOINT/);
  });

  it("PREVIEW_DIRECT_URL without PRODUCTION_DB_ENDPOINT or without a Preview DATABASE_URL fails", () => {
    expect(planMigration({ ...isolatedPreview, PRODUCTION_DB_ENDPOINT: undefined })).toMatchObject({ action: "fail", reason: expect.stringMatching(/PRODUCTION_DB_ENDPOINT is not/) });
    expect(planMigration({ ...isolatedPreview, DATABASE_URL: undefined })).toMatchObject({ action: "fail", reason: expect.stringMatching(/DATABASE_URL must be set/) });
  });

  it("a malformed endpoint id fails", () => {
    expect(planMigration({ ...isolatedPreview, PRODUCTION_DB_ENDPOINT: PROD_DIRECT })).toMatchObject({ action: "fail", reason: expect.stringMatching(/endpoint id/) });
    expect(planMigration({ ...isolatedPreview, PRODUCTION_DB_ENDPOINT: " EP-PROD-111 " })).toMatchObject({ action: "fail" });
  });
});

describe("Preview — pooled URLs", () => {
  it("a pooled PREVIEW_DIRECT_URL fails", () => {
    expect(planMigration({ ...isolatedPreview, PREVIEW_DIRECT_URL: BRANCH_POOLED })).toMatchObject({ action: "fail", reason: expect.stringMatching(/pooled/) });
  });

  it("a pooled-only Preview (DATABASE_URL, no direct URL) never migrates", () => {
    expect(planMigration({ VERCEL_ENV: "preview", DATABASE_URL: BRANCH_POOLED, PRODUCTION_DB_ENDPOINT: "ep-prod-111" })).toMatchObject({ action: "skip" });
  });
});

describe("Preview — non-Neon / generic hosts", () => {
  it("rejects Preview URLs whose host is not a Neon ep-… endpoint", () => {
    const generic = "postgresql://u:p@db.example.com/db";
    const optionsForm = "postgresql://u:p@x.aws.neon.tech/db?options=endpoint%3Dep-prod-111";
    expect(planMigration({ ...isolatedPreview, PREVIEW_DIRECT_URL: generic, DATABASE_URL: generic })).toMatchObject({ action: "fail", reason: expect.stringMatching(/Neon endpoint host/) });
    expect(planMigration({ ...isolatedPreview, PREVIEW_DIRECT_URL: optionsForm, DATABASE_URL: optionsForm })).toMatchObject({ action: "fail", reason: expect.stringMatching(/Neon endpoint host/) });
    expect(planMigration({ ...isolatedPreview, DATABASE_URL: "postgresql://u:p@localhost:5432/db" })).toMatchObject({ action: "fail", reason: expect.stringMatching(/Neon endpoint host/) });
    expect(planMigration({ ...isolatedPreview, PREVIEW_DIRECT_URL: "not a url" })).toMatchObject({ action: "fail" });
  });
});

describe("Preview — Production URLs supplied as Preview URLs", () => {
  it("never uses DATABASE_URL or a leaked production DIRECT_URL as the migration target", () => {
    expect(planMigration({ VERCEL_ENV: "preview", DATABASE_URL: PROD_POOLED, DIRECT_URL: PROD_DIRECT })).toMatchObject({ action: "skip" });
  });

  it("production pasted into PREVIEW_DIRECT_URL fails when the endpoint id is right", () => {
    expect(planMigration({ ...isolatedPreview, PREVIEW_DIRECT_URL: PROD_DIRECT })).toMatchObject({
      action: "fail",
      reason: expect.stringMatching(/PREVIEW_DIRECT_URL is the PRODUCTION endpoint/),
    });
  });

  it("Preview runtime still on production fails once PRODUCTION_DB_ENDPOINT is known", () => {
    expect(planMigration({ ...isolatedPreview, DATABASE_URL: PROD_POOLED })).toMatchObject({ action: "fail", reason: expect.stringMatching(/points at the PRODUCTION database/) });
    expect(planMigration({ VERCEL_ENV: "preview", DATABASE_URL: PROD_POOLED, PRODUCTION_DB_ENDPOINT: "ep-prod-111" })).toMatchObject({ action: "fail" });
  });

  it("runtime and migration URLs on different branches fail", () => {
    const otherBranch = "postgresql://u:p@ep-other-333-pooler.eu-central-1.aws.neon.tech/db";
    expect(planMigration({ ...isolatedPreview, DATABASE_URL: otherBranch })).toMatchObject({ action: "fail", reason: expect.stringMatching(/different Neon endpoints/) });
  });
});

describe("Preview — swapped or mistyped endpoint ids (layer 1 is fooled; layer 2 must refuse)", () => {
  const swapped = { ...isolatedPreview, PRODUCTION_DB_ENDPOINT: "ep-preview-222", PREVIEW_DIRECT_URL: PROD_DIRECT, DATABASE_URL: PROD_POOLED };
  const typo = { ...isolatedPreview, PRODUCTION_DB_ENDPOINT: "ep-prod-112", PREVIEW_DIRECT_URL: PROD_DIRECT, DATABASE_URL: PROD_POOLED };

  it("the configuration checks alone would plan a migration of production…", () => {
    for (const env of [swapped, typo]) expect(planMigration(env)).toEqual({ action: "migrate", url: PROD_DIRECT, label: "preview branch" });
  });

  it("…but production has no marker, so the marker check refuses", async () => {
    // Production: the marker table does not exist.
    const production = async (sql: string) => (sql.includes("to_regclass") ? [{ value: false }] : []);
    expect(await verifyPreviewMarker(production)).toMatchObject({ ok: false, reason: expect.stringMatching(/not the Preview branch/) });
  });
});

describe("verifyPreviewMarker", () => {
  const db = (rows: { value?: unknown }[]) => async (sql: string) => (sql.includes("to_regclass") ? [{ value: true }] : sql === PREVIEW_MARKER_SQL ? rows : []);

  it("accepts exactly one role = 'preview' row", async () => {
    expect(await verifyPreviewMarker(db([{ value: "preview" }]))).toEqual({ ok: true });
  });

  it("fails closed on a missing row, a wrong value, duplicates or any error", async () => {
    expect(await verifyPreviewMarker(db([]))).toMatchObject({ ok: false });
    expect(await verifyPreviewMarker(db([{ value: "production" }]))).toMatchObject({ ok: false });
    expect(await verifyPreviewMarker(db([{ value: "preview" }, { value: "preview" }]))).toMatchObject({ ok: false });
    expect(
      await verifyPreviewMarker(async () => {
        throw new Error("connection refused");
      }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/Could not verify/) });
  });
});

describe("Custom environments, Development and local builds", () => {
  it("custom environments (VERCEL_ENV=preview, VERCEL_TARGET_ENV=<name>) skip, even with Preview variables", () => {
    expect(planMigration({ ...isolatedPreview, VERCEL_TARGET_ENV: "staging" })).toMatchObject({ action: "skip", reason: expect.stringMatching(/Custom environment "staging"/) });
  });

  it("development skips; local builds migrate DATABASE_URL (unchanged)", () => {
    expect(planMigration({ VERCEL_ENV: "development", DATABASE_URL: PROD_POOLED, PREVIEW_DIRECT_URL: BRANCH_DIRECT })).toMatchObject({ action: "skip" });
    expect(planMigration({ DATABASE_URL: "postgresql://localhost:5432/trading_hub" })).toEqual({ action: "migrate", url: "postgresql://localhost:5432/trading_hub", label: "local" });
  });
});
