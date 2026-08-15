import { Decimal } from "decimal.js";

import { prisma } from "@/server/db";
import { postLedgerEntry } from "@/server/services/account-ledger.service";
import { Prisma } from "@prisma/client";
import type {
  AccountStageStatus,
  AccountStageType,
  LedgerEventType,
  MarketCategory,
  MilestoneType,
  PayoutStatus,
  PropFirmAccountModelType,
  PropFirmAccountStatus,
  PropFirmIdentityKind,
  RuleBreachAction,
  RuleKey,
  RuleValueType,
  UserPropFirmStatus,
} from "@prisma/client";

// ── Shared includes / payload types (consumed by prop-firms.mapper.ts) ──────

const accountStageInclude = {
  rules: { orderBy: { sortOrder: "asc" } },
} satisfies Prisma.AccountStageInclude;

const propFirmAccountInclude = {
  stages: { include: accountStageInclude, orderBy: { order: "asc" } },
  payouts: { orderBy: { createdAt: "desc" } },
  milestones: { orderBy: { achievedAt: "desc" } },
} satisfies Prisma.PropFirmAccountInclude;

const userPropFirmInclude = {
  directoryEntry: true,
  accounts: {
    where: { deletedAt: null },
    include: propFirmAccountInclude,
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.UserPropFirmInclude;

export type PropFirmAccountWithRelations = Prisma.PropFirmAccountGetPayload<{
  include: typeof propFirmAccountInclude;
}>;
export type UserPropFirmWithRelations = Prisma.UserPropFirmGetPayload<{
  include: typeof userPropFirmInclude;
}>;
export type AccountStageWithRules = Prisma.AccountStageGetPayload<{ include: typeof accountStageInclude }>;

// ── User Prop Firms ──────────────────────────────────────────────────────────

export interface CreateUserPropFirmInput {
  identityKind: PropFirmIdentityKind;
  directoryEntryId?: string | null;
  customCompanyName?: string | null;
  customLogoUrl?: string | null;
  customWebsite?: string | null;
  customAccentColor?: string | null;
  marketCategory: MarketCategory;
  isPriority?: boolean;
  priorityOrder?: number | null;
  notes?: string | null;
}

export interface UpdateUserPropFirmInput {
  isPriority?: boolean;
  priorityOrder?: number | null;
  status?: UserPropFirmStatus;
  notes?: string | null;
  customCompanyName?: string | null;
  customLogoUrl?: string | null;
  customWebsite?: string | null;
  customAccentColor?: string | null;
}

/** Lightweight list of the user's active PropFirmAccounts for the Trade
 *  Idea's Account Allocation selector (spec §2: search by firm/logo/
 *  nickname/stage/market). ACTIVE accounts only — a failed/breached/
 *  archived account can't take a new allocation (enforced again, harder, by
 *  trade-executions.service.ts at write time). */
export function listActivePropFirmAccountsForSelector(userId: string) {
  return prisma.propFirmAccount.findMany({
    where: { userId, status: "ACTIVE" },
    include: {
      userPropFirm: { include: { directoryEntry: true } },
      stages: { where: { status: "ACTIVE" }, orderBy: { order: "desc" }, take: 1 },
    },
    orderBy: { displayName: "asc" },
  });
}

/** Every firm the trader has added, priorities first, each with its
 *  purchased accounts (archived accounts included — "archived" is a status,
 *  not a soft-delete, see archivePropFirmAccount) and their full stage/rule/
 *  payout/milestone history. */
export function listUserPropFirms(userId: string) {
  return prisma.userPropFirm.findMany({
    where: { userId },
    include: userPropFirmInclude,
    orderBy: [{ isPriority: "desc" }, { priorityOrder: "asc" }, { createdAt: "asc" }],
  });
}

/** One firm, fully loaded, for the Company Workspace. */
export async function getUserPropFirmDetail(userId: string, id: string) {
  const firm = await prisma.userPropFirm.findFirst({
    where: { id, userId },
    include: userPropFirmInclude,
  });
  if (!firm) throw new Error("Prop firm not found.");
  return firm;
}

/** One account, fully loaded (plus its parent firm), for the Account Detail
 *  Workspace. */
export async function getAccountDetail(userId: string, accountId: string) {
  const account = await prisma.propFirmAccount.findFirst({
    where: { id: accountId, userId },
    include: {
      ...propFirmAccountInclude,
      userPropFirm: { include: { directoryEntry: true } },
    },
  });
  if (!account) throw new Error("Account not found.");
  return account;
}

/** Sets `priorityOrder` to each id's position in `orderedIds` — only firms
 *  already marked `isPriority` should be passed in (the UI only lets you
 *  drag among priority firms). Ownership-scoped per row; a stray id from
 *  another user is silently skipped rather than throwing, since a reorder
 *  is best-effort UI state, not a single-record mutation. */
export async function reorderPriorityFirms(userId: string, orderedIds: string[]): Promise<void> {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.userPropFirm.updateMany({
        where: { id, userId },
        data: { priorityOrder: index },
      }),
    ),
  );
}

export function createUserPropFirm(userId: string, input: CreateUserPropFirmInput) {
  return prisma.userPropFirm.create({
    data: { userId, ...input },
  });
}

/** Scoped via the direct `userId` column — same one-step pattern as
 *  `archiveTradingAccount` (Prisma throws "not found" if the row isn't the
 *  caller's, which is the ownership check). */
export function updateUserPropFirm(userId: string, id: string, input: UpdateUserPropFirmInput) {
  return prisma.userPropFirm.update({
    where: { id, userId },
    data: input,
  });
}

// ── Purchased Accounts ───────────────────────────────────────────────────────

export interface CreateAccountStageDraft {
  name: string;
  type: AccountStageType;
  rules?: CreateStageRuleInput[];
}

export interface CreatePropFirmAccountInput {
  userPropFirmId: string;
  displayName: string;
  externalRef?: string | null;
  marketCategory: MarketCategory;
  modelName?: string | null;
  modelType: PropFirmAccountModelType;
  accountSize: number;
  accountCurrency?: string;
  purchasePrice?: number | null;
  discount?: number | null;
  resetFees?: number | null;
  activationFees?: number | null;
  otherCosts?: number | null;
  purchaseDate?: Date | null;
  platform?: string | null;
  dataFeed?: string | null;
  notes?: string | null;
  /** The full stage structure (with per-stage rules) from the Add Account
   *  wizard. When omitted, falls back to a single auto-named first stage
   *  (Phase 1, or Master/Funded for INSTANT_FUNDED) with no rules — the
   *  Phase 1 foundation's behavior, kept for any caller that doesn't go
   *  through the wizard. */
  stages?: CreateAccountStageDraft[];
}

export interface UpdatePropFirmAccountInput {
  displayName?: string;
  externalRef?: string | null;
  modelName?: string | null;
  modelType?: PropFirmAccountModelType;
  status?: PropFirmAccountStatus;
  currentBalance?: number | null;
  currentEquity?: number | null;
  platform?: string | null;
  dataFeed?: string | null;
  notes?: string | null;
}

function initialStageType(modelType: PropFirmAccountModelType): AccountStageType {
  return modelType === "INSTANT_FUNDED" ? "MASTER_FUNDED" : "PHASE_1";
}

/** Creates the purchased account, its paired ledger row (the existing
 *  TradingAccount trades already allocate against — untouched mechanism),
 *  its first stage, and an ACCOUNT_PURCHASED milestone — one transaction, so
 *  a caller never sees a purchased account with no ledger or no stage. */
export async function createPropFirmAccount(userId: string, input: CreatePropFirmAccountInput) {
  const firm = await prisma.userPropFirm.findFirst({
    where: { id: input.userPropFirmId, userId },
    select: { id: true },
  });
  if (!firm) throw new Error("Prop firm not found.");

  return prisma.$transaction(async (tx) => {
    const tradingAccount = await tx.tradingAccount.create({
      data: {
        userId,
        kind: "PROP_FIRM",
        name: input.displayName,
        status: "ACTIVE",
        accountSize: input.accountSize,
        purchaseCost: input.purchasePrice ?? null,
      },
    });

    const account = await tx.propFirmAccount.create({
      data: {
        userId,
        userPropFirmId: input.userPropFirmId,
        tradingAccountId: tradingAccount.id,
        displayName: input.displayName,
        externalRef: input.externalRef ?? null,
        marketCategory: input.marketCategory,
        modelName: input.modelName ?? null,
        modelType: input.modelType,
        accountSize: input.accountSize,
        accountCurrency: input.accountCurrency ?? "USD",
        purchasePrice: input.purchasePrice ?? null,
        discount: input.discount ?? null,
        resetFees: input.resetFees ?? null,
        activationFees: input.activationFees ?? null,
        otherCosts: input.otherCosts ?? null,
        purchaseDate: input.purchaseDate ?? null,
        platform: input.platform ?? null,
        dataFeed: input.dataFeed ?? null,
        startingBalance: input.accountSize,
        notes: input.notes ?? null,
      },
    });

    const stageDrafts: CreateAccountStageDraft[] =
      input.stages && input.stages.length > 0
        ? input.stages
        : [{ name: initialStageType(input.modelType).replace(/_/g, " "), type: initialStageType(input.modelType) }];

    let firstStageId: string | null = null;
    for (const [index, draft] of stageDrafts.entries()) {
      const stage = await tx.accountStage.create({
        data: {
          accountId: account.id,
          name: draft.name,
          order: index + 1,
          type: draft.type,
          // Every stage starts from the account's size — a stage that
          // resets or scales gets its own real starting balance later, via
          // advanceAccountStage's `nextStage.startingBalance`.
          startingBalance: input.accountSize,
          // Only the first stage is immediately active; the rest wait their
          // turn (advanceAccountStage activates them one at a time).
          startDate: index === 0 ? new Date() : null,
          status: index === 0 ? "ACTIVE" : "PENDING",
        },
      });
      if (index === 0) firstStageId = stage.id;
      if (draft.rules && draft.rules.length > 0) {
        await tx.stageRule.createMany({
          data: draft.rules.map((rule, ruleIndex) => ({ stageId: stage.id, sortOrder: ruleIndex, ...rule })),
        });
      }
    }

    await tx.accountMilestone.create({
      data: {
        accountId: account.id,
        type: "ACCOUNT_PURCHASED",
        title: `${input.displayName} purchased`,
      },
    });

    // Opening ledger entry — every account's balance history starts here so
    // PropFirmAccount.currentBalance can be derived from the ledger going
    // forward (see account-ledger.service.ts / domain/prop-firms/track-record.ts).
    await postLedgerEntry(tx, {
      accountId: account.id,
      stageId: firstStageId,
      eventType: "ACCOUNT_INITIALIZED",
      amount: input.accountSize,
      sourceType: "ACCOUNT_INIT",
      sourceId: account.id,
    });

    return account;
  });
}

export async function updatePropFirmAccount(
  userId: string,
  id: string,
  input: UpdatePropFirmAccountInput,
) {
  const owned = await prisma.propFirmAccount.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) throw new Error("Account not found.");
  return prisma.propFirmAccount.update({ where: { id }, data: input });
}

/**
 * Archiving is a reversible status change (the account stays visible — the
 * Company/Account workspaces have their own "archived" treatment) — NOT a
 * soft-delete. `deletedAt` is reserved for actual removal, which this phase
 * doesn't expose in the UI.
 */
export async function archivePropFirmAccount(userId: string, id: string) {
  const owned = await prisma.propFirmAccount.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) throw new Error("Account not found.");
  return prisma.propFirmAccount.update({
    where: { id },
    data: { status: "ARCHIVED", archivedAt: new Date() },
  });
}

export async function reactivatePropFirmAccount(userId: string, id: string) {
  const owned = await prisma.propFirmAccount.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) throw new Error("Account not found.");
  return prisma.propFirmAccount.update({
    where: { id },
    data: { status: "ACTIVE", archivedAt: null },
  });
}

// ── Stages ────────────────────────────────────────────────────────────────

/** The stage an account is currently "in" — derived, never stored (mirrors
 *  TradingAccount.currentBalance never being a column either). Exactly one
 *  ACTIVE stage per account holds by construction of advanceAccountStage
 *  below; stages after it may already exist as PENDING placeholders (a
 *  wizard-planned structure) but aren't "current" until activated. */
export async function getCurrentStage(userId: string, accountId: string) {
  const account = await prisma.propFirmAccount.findFirst({
    where: { id: accountId, userId },
    select: { id: true },
  });
  if (!account) throw new Error("Account not found.");
  return prisma.accountStage.findFirst({
    where: { accountId, status: "ACTIVE" },
    orderBy: { order: "desc" },
  });
}

const CLOSE_TO_MILESTONE: Record<
  Extract<AccountStageStatus, "PASSED" | "FAILED" | "BREACHED" | "RESET" | "ABANDONED">,
  MilestoneType
> = {
  PASSED: "PHASE_PASSED",
  FAILED: "PHASE_FAILED",
  BREACHED: "ACCOUNT_BREACHED",
  RESET: "STAGE_RESET",
  ABANDONED: "CUSTOM",
};

// No ledger event for ABANDONED — it's not one of spec §5's event types and
// already gets a CUSTOM milestone above; nothing informational to add.
const CLOSE_TO_LEDGER_EVENT: Partial<
  Record<Extract<AccountStageStatus, "PASSED" | "FAILED" | "BREACHED" | "RESET" | "ABANDONED">, LedgerEventType>
> = {
  PASSED: "STAGE_PASSED",
  FAILED: "STAGE_FAILED",
  BREACHED: "ACCOUNT_BREACHED",
  RESET: "STAGE_STARTING_BALANCE_RESET",
};

export interface AdvanceStageInput {
  closeStatus: "PASSED" | "FAILED" | "BREACHED" | "RESET" | "ABANDONED";
  completionNotes?: string | null;
  finalBalance?: number | null;
  /**
   * Omit both to close the account out with no successor (e.g. a terminal
   * fail). If the account already has a PENDING stage lined up after this
   * one (the normal case — the wizard pre-plans the full stage structure),
   * it's activated automatically; pass `nextStage` explicitly only to
   * define a stage that wasn't pre-planned (an ad-hoc reset, a stage added
   * after the fact, or the Phase-1-foundation single-stage accounts).
   */
  nextStage?: {
    name: string;
    type: AccountStageType;
    startingBalance: number;
  } | null;
}

/**
 * Closes the account's current ACTIVE stage and activates whatever comes
 * next — one transaction, so a stage's performance is never left partially
 * written and the previous stage's fields are never mutated again after this
 * call. This is the only way a stage transitions; there is no standalone
 * "create arbitrary stage" API. Returns the newly-logged milestone's id so
 * the caller can attach a certificate/evidence upload to it.
 */
export async function advanceAccountStage(
  userId: string,
  accountId: string,
  input: AdvanceStageInput,
) {
  const account = await prisma.propFirmAccount.findFirst({
    where: { id: accountId, userId },
    select: { id: true },
  });
  if (!account) throw new Error("Account not found.");

  return prisma.$transaction(async (tx) => {
    const current = await tx.accountStage.findFirst({
      where: { accountId, status: "ACTIVE" },
      orderBy: { order: "desc" },
    });
    if (!current) throw new Error("This account has no active stage to advance.");

    const finalBalance = new Decimal(input.finalBalance ?? current.startingBalance.toString());
    const closed = await tx.accountStage.update({
      where: { id: current.id },
      data: {
        status: input.closeStatus,
        completionDate: new Date(),
        currentBalance: finalBalance.toString(),
        profitLoss: finalBalance.minus(current.startingBalance.toString()).toString(),
        completionNotes: input.completionNotes ?? null,
      },
    });

    let next = null;
    if (input.nextStage) {
      next = await tx.accountStage.create({
        data: {
          accountId,
          name: input.nextStage.name,
          order: current.order + 1,
          type: input.nextStage.type,
          startingBalance: input.nextStage.startingBalance,
          startDate: new Date(),
          status: "ACTIVE",
        },
      });
    } else if (input.closeStatus === "PASSED") {
      // Only a pass auto-advances to a pre-planned next stage — a breach,
      // fail, or abandon is a terminal outcome for this run; a reset
      // restarts the same stage type, which needs an explicit `nextStage`,
      // not whatever the wizard happened to pre-plan after it.
      const pending = await tx.accountStage.findFirst({
        where: { accountId, status: "PENDING", order: { gt: current.order } },
        orderBy: { order: "asc" },
      });
      if (pending) {
        next = await tx.accountStage.update({
          where: { id: pending.id },
          data: { status: "ACTIVE", startDate: new Date() },
        });
      }
    }

    // A terminal negative outcome with nothing next activated closes the
    // account out at the same status — otherwise a breached/failed account
    // would keep reading as "ACTIVE" everywhere in the UI.
    if (!next && (input.closeStatus === "BREACHED" || input.closeStatus === "FAILED")) {
      await tx.propFirmAccount.update({ where: { id: accountId }, data: { status: input.closeStatus } });
    }

    const milestone = await tx.accountMilestone.create({
      data: {
        accountId,
        stageId: closed.id,
        type: CLOSE_TO_MILESTONE[input.closeStatus],
        title: next ? `Advanced to ${next.name}` : `Stage ${input.closeStatus.toLowerCase()}`,
      },
    });

    // Ledger: an informational marker for the transition (amount 0 — the
    // balance movement itself was already posted by TRADE_PNL entries during
    // the stage; this just records WHY the stage closed).
    const transitionEventType = CLOSE_TO_LEDGER_EVENT[input.closeStatus];
    if (transitionEventType) {
      await postLedgerEntry(tx, {
        accountId,
        stageId: closed.id,
        eventType: transitionEventType,
        amount: 0,
        sourceType: "STAGE_TRANSITION",
        sourceId: closed.id,
      });
    }

    // When the next stage starts from a balance different than what the
    // ledger currently shows (a reset/scale), post the delta so the ledger
    // — not just the AccountStage row — reflects it.
    if (next) {
      const latestEntry = await tx.accountLedgerEntry.findFirst({
        where: { accountId },
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        select: { balanceAfter: true },
      });
      const ledgerBalance = latestEntry ? new Decimal(latestEntry.balanceAfter.toString()) : new Decimal(0);
      const nextStartingBalance = new Decimal(next.startingBalance.toString());
      if (!nextStartingBalance.equals(ledgerBalance)) {
        await postLedgerEntry(tx, {
          accountId,
          stageId: next.id,
          eventType: "STAGE_STARTING_BALANCE_RESET",
          amount: nextStartingBalance.minus(ledgerBalance),
          sourceType: "STAGE_TRANSITION",
          sourceId: next.id,
        });
      }
    }

    return { closed, next, milestoneId: milestone.id };
  });
}

// ── Stage Rules ───────────────────────────────────────────────────────────

export interface CreateStageRuleInput {
  name: string;
  ruleKey: RuleKey;
  valueType: RuleValueType;
  numericValue?: number | null;
  booleanValue?: boolean | null;
  textValue?: string | null;
  measurementBasis?: string | null;
  measurementPeriod?: string | null;
  warningThreshold?: number | null;
  breachThreshold?: number | null;
  breachAction?: RuleBreachAction | null;
  description?: string | null;
  isEnabled?: boolean;
}

async function assertOwnsStage(userId: string, stageId: string) {
  const stage = await prisma.accountStage.findFirst({
    where: { id: stageId, account: { userId } },
    select: { id: true },
  });
  if (!stage) throw new Error("Stage not found.");
}

export async function createStageRule(userId: string, stageId: string, input: CreateStageRuleInput) {
  await assertOwnsStage(userId, stageId);
  const count = await prisma.stageRule.count({ where: { stageId } });
  return prisma.stageRule.create({ data: { stageId, sortOrder: count, ...input } });
}

export async function updateStageRule(
  userId: string,
  ruleId: string,
  input: Partial<CreateStageRuleInput>,
) {
  const rule = await prisma.stageRule.findFirst({
    where: { id: ruleId, stage: { account: { userId } } },
    select: { id: true },
  });
  if (!rule) throw new Error("Rule not found.");
  return prisma.stageRule.update({ where: { id: ruleId }, data: input });
}

/** Disabling (isEnabled: false) rather than deleting is the intended way to
 *  turn off a rule — its history/config survives (spec: "Disable rules
 *  without deleting their history"). Deleting is still possible via
 *  updateStageRule's underlying model if ever needed, but no delete action
 *  is exposed — a rule config is small enough it's never worth losing. */
export async function reorderStageRules(userId: string, stageId: string, orderedRuleIds: string[]): Promise<void> {
  await assertOwnsStage(userId, stageId);
  await prisma.$transaction(
    orderedRuleIds.map((id, index) =>
      prisma.stageRule.updateMany({ where: { id, stageId }, data: { sortOrder: index } }),
    ),
  );
}

/** Copies every enabled+disabled rule from one stage to another (both must
 *  belong to the caller) — "Copy appropriate rules between stages". Ids are
 *  never reused; each copy is an independent row. */
export async function copyStageRules(userId: string, fromStageId: string, toStageId: string) {
  await assertOwnsStage(userId, fromStageId);
  await assertOwnsStage(userId, toStageId);
  const source = await prisma.stageRule.findMany({ where: { stageId: fromStageId }, orderBy: { sortOrder: "asc" } });
  const existingCount = await prisma.stageRule.count({ where: { stageId: toStageId } });

  if (source.length === 0) return [];
  return prisma.$transaction(
    source.map((rule, index) =>
      prisma.stageRule.create({
        data: {
          stageId: toStageId,
          sortOrder: existingCount + index,
          name: rule.name,
          ruleKey: rule.ruleKey,
          valueType: rule.valueType,
          numericValue: rule.numericValue,
          booleanValue: rule.booleanValue,
          textValue: rule.textValue,
          measurementBasis: rule.measurementBasis,
          measurementPeriod: rule.measurementPeriod,
          warningThreshold: rule.warningThreshold,
          breachThreshold: rule.breachThreshold,
          breachAction: rule.breachAction,
          description: rule.description,
          isEnabled: rule.isEnabled,
        },
      }),
    ),
  );
}

// ── Milestones ────────────────────────────────────────────────────────────

export interface CreateMilestoneInput {
  stageId?: string | null;
  type: MilestoneType;
  title?: string | null;
  description?: string | null;
  achievedAt?: Date;
}

export async function createAccountMilestone(
  userId: string,
  accountId: string,
  input: CreateMilestoneInput,
) {
  const owned = await prisma.propFirmAccount.findFirst({ where: { id: accountId, userId }, select: { id: true } });
  if (!owned) throw new Error("Account not found.");
  return prisma.accountMilestone.create({ data: { accountId, ...input } });
}

// ── Payouts ───────────────────────────────────────────────────────────────

export interface CreatePayoutInput {
  stageId?: string | null;
  grossPayout: number;
  profitSplitPercent?: number | null;
  netExpected?: number | null;
  requestedDate?: Date | null;
  paymentMethod?: string | null;
  notes?: string | null;
}

export async function createPayout(userId: string, accountId: string, input: CreatePayoutInput) {
  const owned = await prisma.propFirmAccount.findFirst({ where: { id: accountId, userId }, select: { id: true } });
  if (!owned) throw new Error("Account not found.");
  return prisma.payout.create({ data: { accountId, status: "AVAILABLE", ...input } });
}

export interface UpdatePayoutInput {
  status?: PayoutStatus;
  netReceived?: number | null;
  approvedDate?: Date | null;
  paidDate?: Date | null;
  referenceId?: string | null;
  feesDeductions?: number | null;
  notes?: string | null;
}

/** Updates a payout. When `status` transitions to PAID (and only then — a
 *  second update that leaves it PAID is a no-op for the ledger/milestone
 *  side, though the row's other fields still update), posts one negative
 *  PAYOUT ledger entry (money leaving the account's own balance — the
 *  profit was already recognized via TRADE_PNL entries, so this never
 *  double-counts) and creates a PAYOUT_RECEIVED milestone, in one
 *  transaction. Returns `{ payout, milestoneId }` — `milestoneId` is null
 *  when this call didn't trigger a PAID transition, so the caller can chain
 *  a certificate/evidence upload the same way advanceAccountStage does. */
export async function updatePayout(userId: string, payoutId: string, input: UpdatePayoutInput) {
  const existing = await prisma.payout.findFirst({
    where: { id: payoutId, account: { userId } },
  });
  if (!existing) throw new Error("Payout not found.");

  const isPaidTransition = input.status === "PAID" && existing.status !== "PAID";

  return prisma.$transaction(async (tx) => {
    const payout = await tx.payout.update({ where: { id: payoutId }, data: input });

    let milestoneId: string | null = null;
    if (isPaidTransition) {
      // `payout` is the just-updated row, so its netReceived/feesDeductions
      // already reflect this call's input (or the prior stored value when
      // this call didn't touch them) — falls back to gross − fees only when
      // netReceived was never set at all.
      const netReceived =
        payout.netReceived != null
          ? new Decimal(payout.netReceived.toString())
          : new Decimal(payout.grossPayout.toString()).minus(payout.feesDeductions?.toString() ?? 0);

      await postLedgerEntry(tx, {
        accountId: payout.accountId,
        stageId: payout.stageId,
        eventType: "PAYOUT",
        amount: netReceived.negated(),
        occurredAt: input.paidDate ?? payout.paidDate ?? new Date(),
        sourceType: "PAYOUT",
        sourceId: payout.id,
      });

      const milestone = await tx.accountMilestone.create({
        data: {
          accountId: payout.accountId,
          stageId: payout.stageId,
          type: "PAYOUT_RECEIVED",
          title: `Payout received (${netReceived.toFixed(2)})`,
        },
      });
      milestoneId = milestone.id;
    }

    return { payout, milestoneId };
  });
}
