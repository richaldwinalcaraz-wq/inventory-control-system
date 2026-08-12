import type { ApprovalThreshold, Prisma, PrismaClient } from "@prisma/client";

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * Thrown when no ApprovalThreshold row covers the given transaction type
 * and value, at either the branch-specific or global-default level. The
 * engine fails closed — it never silently lets an unconfigured transaction
 * type post unapproved.
 */
export class NoApprovalThresholdConfiguredError extends Error {}

export interface ResolveRequiredApproverParams {
  branchId: string;
  transactionType: string; // e.g. "RECEIVING" — matches business-process-design.md Appendix B categories
  value: number | string;
}

/**
 * Looks up which role must approve a transaction of this type and value.
 * A branch-specific threshold row (branchId set) overrides the global
 * default row (branchId null) for the same transactionType/range.
 */
export async function resolveRequiredApprover(
  db: Db,
  params: ResolveRequiredApproverParams,
): Promise<ApprovalThreshold> {
  const value = typeof params.value === "string" ? Number(params.value) : params.value;

  const branchSpecific = await db.approvalThreshold.findFirst({
    where: {
      branchId: params.branchId,
      transactionType: params.transactionType,
      minValue: { lte: value },
      OR: [{ maxValue: null }, { maxValue: { gte: value } }],
    },
    orderBy: { minValue: "desc" },
  });
  if (branchSpecific) return branchSpecific;

  const globalDefault = await db.approvalThreshold.findFirst({
    where: {
      branchId: null,
      transactionType: params.transactionType,
      minValue: { lte: value },
      OR: [{ maxValue: null }, { maxValue: { gte: value } }],
    },
    orderBy: { minValue: "desc" },
  });
  if (globalDefault) return globalDefault;

  throw new NoApprovalThresholdConfiguredError(
    `No approval threshold configured for transactionType="${params.transactionType}" value=${value} branch=${params.branchId}. Register a threshold before this transaction type can be approved — never falls back to "no approval needed."`,
  );
}
