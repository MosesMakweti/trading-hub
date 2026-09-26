import { currentWorkspaceScope, scopeBacktestRunId } from "@/server/workspace/scope";

/**
 * Backtesting Environment (Stage 1) — the Prisma query extension that makes
 * the ambient workspace scope (server/workspace/scope.ts) authoritative.
 *
 * ROOT models carry the `backtestRunId` discriminator themselves (NULL =
 * LIVE). Every read/update/delete on them gets `backtestRunId = <scope>`
 * ANDed into its `where`, and every create is stamped with the scope's run id.
 *
 * CHILD models have no discriminator of their own — they inherit their
 * environment from the root they hang off (a plan version from its Trade, an
 * asset analysis from its TradingDay). Top-level reads/updates/deletes on
 * them get the equivalent relation filter, so e.g. a user-wide
 * `tradePlanVersion.findMany({ where: { userId } })` can never aggregate a
 * simulated trade's versions into a live view. Creates need no stamping: a
 * child can only be created under a parent id, and that parent was itself
 * resolved inside the scope.
 *
 * An explicit, defined `backtestRunId` in a root query's own `where`/`data`
 * wins over the ambient scope (a deliberate cross-scope query — e.g. the run
 * overview counting each run's trades). The one combination refused outright
 * is creating a LIVE root row while inside a BACKTEST scope.
 *
 * Raw SQL ($queryRaw/$executeRaw) is NOT covered — every raw query touching
 * these tables must scope itself (see trades.service.ts's nextTradeNumber).
 * Nested relation reads from OTHER models (e.g. `strategy.findMany({ include:
 * { trades } })`) are not covered either; docs/BACKTESTING.md lists the audit.
 */

const ROOT_MODELS = new Set(["Trade", "TradingDay", "TradeOpportunity", "DailyNote"]);

type RelationFilter = (runId: string | null) => Record<string, unknown>;

const viaTrade: RelationFilter = (runId) => ({ trade: { backtestRunId: runId } });

const CHILD_MODELS: Record<string, RelationFilter> = {
  DailyAssetAnalysis: (runId) => ({ tradingDay: { backtestRunId: runId } }),
  DirectionalEvidenceItem: (runId) => ({ dailyAssetAnalysis: { tradingDay: { backtestRunId: runId } } }),
  TradePlanVersion: viaTrade,
  PlannedTarget: viaTrade,
  TradeActualPartialExit: viaTrade,
  TradeBehaviourLabel: viaTrade,
  PsychologyQuestionnaireResponse: viaTrade,
  TradePlanScreenshot: viaTrade,
};

const WHERE_OPERATIONS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

const CREATE_OPERATIONS = new Set(["create", "createMany", "createManyAndReturn", "upsert"]);

export class WorkspaceScopeViolationError extends Error {
  constructor(message: string) {
    super(`BACKTEST_ISOLATION: ${message}`);
    this.name = "WorkspaceScopeViolationError";
  }
}

type Where = Record<string, unknown> & { AND?: unknown };

/** ANDs `filter` into `where` without overwriting any key the caller set —
 *  safe for both WhereInput and (extended) WhereUniqueInput. */
function andInto(where: Where | undefined, filter: Record<string, unknown>): Where {
  const base = where ?? {};
  const existing = base.AND == null ? [] : Array.isArray(base.AND) ? base.AND : [base.AND];
  return { ...base, AND: [...existing, filter] };
}

function hasExplicitRunId(obj: Record<string, unknown> | undefined): boolean {
  return obj != null && obj.backtestRunId !== undefined;
}

function stampCreateData(model: string, data: Record<string, unknown>, runId: string | null): Record<string, unknown> {
  const scope = currentWorkspaceScope();
  const explicit = data.backtestRunId !== undefined || data.backtestRun !== undefined;
  if (explicit) {
    const explicitRunId =
      data.backtestRunId !== undefined
        ? (data.backtestRunId as string | null)
        : ((data.backtestRun as { connect?: { id?: string } } | undefined)?.connect?.id ?? null);
    if (scope.environment === "BACKTEST" && explicitRunId !== scope.backtestRunId) {
      throw new WorkspaceScopeViolationError(
        `refusing to create a ${model} outside backtest run ${scope.backtestRunId} while inside its scope`,
      );
    }
    return data;
  }
  if (runId == null) return data; // LIVE: the column defaults to NULL
  // Checked (relation-style) inputs can't mix in a scalar FK.
  if (data.user !== undefined) return { ...data, backtestRun: { connect: { id: runId } } };
  return { ...data, backtestRunId: runId };
}

// Structural types only — keeps this module independent of the generated
// client's per-model arg types (the extension is applied in server/db.ts).
interface QueryHookParams {
  model?: string;
  operation: string;
  args: Record<string, unknown>;
  query: (args: Record<string, unknown>) => Promise<unknown>;
}

export async function applyWorkspaceScope({ model, operation, args, query }: QueryHookParams): Promise<unknown> {
  if (!model) return query(args);
  const isRoot = ROOT_MODELS.has(model);
  const childFilter = CHILD_MODELS[model];
  if (!isRoot && !childFilter) return query(args);

  const runId = scopeBacktestRunId();
  if (runId === undefined) return query(args); // UNSCOPED

  const next: Record<string, unknown> = { ...args };

  if (WHERE_OPERATIONS.has(operation)) {
    const where = args.where as Where | undefined;
    if (isRoot) {
      if (!hasExplicitRunId(where)) next.where = andInto(where, { backtestRunId: runId });
    } else {
      next.where = andInto(where, childFilter(runId));
    }
  }

  if (isRoot && CREATE_OPERATIONS.has(operation)) {
    if (operation === "upsert") {
      next.create = stampCreateData(model, args.create as Record<string, unknown>, runId);
    } else if (Array.isArray(args.data)) {
      next.data = (args.data as Record<string, unknown>[]).map((d) => stampCreateData(model, d, runId));
    } else {
      next.data = stampCreateData(model, args.data as Record<string, unknown>, runId);
    }
  }

  return query(next);
}
