import type { Prisma, PrismaClient, RoleName } from "@prisma/client";

type Db = Prisma.TransactionClient | PrismaClient;

export class FuturePostingNotAllowedError extends Error {}
export class BackdatingLimitExceededError extends Error {}
export class SupervisorApprovalRequiredError extends Error {}
export class PeriodLockedError extends Error {}

const SUPERVISOR_OR_ABOVE: readonly RoleName[] = ["WAREHOUSE_SUPERVISOR", "BRANCH_MANAGER", "OWNER"];
const MAX_BACKDATE_DAYS = 3;

export interface ValidatePostingDateParams {
  branchId: string;
  /** The business date the transaction is being posted to. */
  postingDate: Date;
  /** Injectable for tests; defaults to the real current time. */
  today?: Date;
  /** Required once backdating 1–MAX_BACKDATE_DAYS days; ignored for same-day posting. */
  supervisorApproval?: { approvedBy: string; approvedByRole: RoleName };
}

/**
 * Enforces backdating and period-close rules at posting time — the same
 * rule set for every transaction type, not re-implemented per workflow.
 *
 * Same-day posting: free. Backdating 1-3 days: requires Supervisor (or
 * above) approval. Backdating beyond 3 days: never allowed, approval or
 * not. Posting into an already-locked period: never allowed, regardless
 * of how many days back it is — this check is independent of the backdate
 * window above, since a period can close before the 3-day window expires.
 */
export async function validatePostingDate(db: Db, params: ValidatePostingDateParams): Promise<void> {
  const today = params.today ?? new Date();
  const diffDays = daysBetween(today, params.postingDate);

  if (diffDays < 0) {
    throw new FuturePostingNotAllowedError(
      `Cannot post to a future date (${params.postingDate.toISOString().slice(0, 10)}).`,
    );
  }
  if (diffDays > MAX_BACKDATE_DAYS) {
    throw new BackdatingLimitExceededError(
      `Cannot backdate more than ${MAX_BACKDATE_DAYS} days (attempted ${diffDays} days).`,
    );
  }
  if (diffDays >= 1) {
    if (!params.supervisorApproval || !SUPERVISOR_OR_ABOVE.includes(params.supervisorApproval.approvedByRole)) {
      throw new SupervisorApprovalRequiredError(
        `Backdating ${diffDays} day(s) requires Supervisor (or above) approval.`,
      );
    }
  }

  const lockedPeriod = await db.period.findFirst({
    where: {
      branchId: params.branchId,
      isLocked: true,
      periodStart: { lte: params.postingDate },
      periodEnd: { gte: params.postingDate },
    },
  });
  if (lockedPeriod) {
    throw new PeriodLockedError(
      `The accounting period covering ${params.postingDate.toISOString().slice(0, 10)} at branch ${params.branchId} is locked and cannot accept new postings.`,
    );
  }
}

// Calendar-date difference (ignores time-of-day), computed in UTC — this
// project's timestamps are UTC-normalized end to end (see the timezone
// fix in migration 20260811130500). "Today minus 2 days" here means 2
// full UTC calendar days, not a 48-hour window.
function daysBetween(today: Date, postingDate: Date): number {
  const toDateOnlyUtc = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const diffMs = toDateOnlyUtc(today) - toDateOnlyUtc(postingDate);
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}
