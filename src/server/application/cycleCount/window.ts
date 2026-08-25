import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { lockCycleCountWindowRow } from "../../domain/cycleCount/branchLock";
import { scanCountWindowViolations } from "./violation";

export class CycleCountWindowAlreadyActiveError extends Error {}
export class CycleCountWindowNotFoundError extends Error {}
export class CycleCountWindowNotActiveError extends Error {}
export class ExceptionReasonRequiredError extends Error {}

const DEFAULT_EXCEPTION_TTL_MINUTES = 30;

export interface DeclareCycleCountWindowParams {
  actorUserId: string;
  actorRole: RoleName;
  branchId: string;
  notes?: string;
}

/**
 * G-08 branch-wide freeze. Locks CycleCountWindowLock before checking for
 * an existing ACTIVE window — closes the write-skew race where two
 * Supervisors could otherwise both read "no active window" and both insert
 * (Phase 4 plan sec.2.2).
 */
export async function declareCycleCountWindow(prisma: PrismaClient, params: DeclareCycleCountWindowParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "cycle-count.window.declare.create" });

  return prisma.$transaction(async (tx) => {
    await lockCycleCountWindowRow(tx, { branchId: params.branchId });

    const existing = await tx.cycleCountWindow.findFirst({ where: { branchId: params.branchId, status: "ACTIVE" } });
    if (existing) {
      throw new CycleCountWindowAlreadyActiveError(
        `Branch ${params.branchId} already has an active cycle count window (${existing.id}) — close it before declaring a new one.`,
      );
    }

    return tx.cycleCountWindow.create({
      data: {
        branchId: params.branchId,
        declaredBy: params.actorUserId,
        notes: params.notes,
      },
    });
  });
}

export interface CloseCycleCountWindowParams {
  actorUserId: string;
  actorRole: RoleName;
  cycleCountWindowId: string;
}

export interface CloseCycleCountWindowResult {
  window: Awaited<ReturnType<PrismaClient["cycleCountWindow"]["findUniqueOrThrow"]>>;
  violations: Awaited<ReturnType<typeof scanCountWindowViolations>>;
}

/**
 * Atomic-claim close (updateMany where status=ACTIVE), same shape as every
 * other single-document posting transition in this codebase, then runs
 * G-08's violation scan inline (also independently callable later via
 * checkCountWindowViolations in violation.ts).
 */
export async function closeCycleCountWindow(prisma: PrismaClient, params: CloseCycleCountWindowParams): Promise<CloseCycleCountWindowResult> {
  await assertPermission(prisma, { role: params.actorRole, action: "cycle-count.window.close.create" });

  const result = await prisma.cycleCountWindow.updateMany({
    where: { id: params.cycleCountWindowId, status: "ACTIVE" },
    data: { status: "CLOSED", endedAt: new Date() },
  });

  if (result.count === 0) {
    const found = await prisma.cycleCountWindow.findUnique({ where: { id: params.cycleCountWindowId } });
    if (!found) throw new CycleCountWindowNotFoundError(params.cycleCountWindowId);
    throw new CycleCountWindowNotActiveError(`Cycle count window ${params.cycleCountWindowId} is already ${found.status}.`);
  }

  const window = await prisma.cycleCountWindow.findUniqueOrThrow({ where: { id: params.cycleCountWindowId } });
  const violations = await scanCountWindowViolations(prisma, { window, actorUserId: params.actorUserId });

  return { window, violations };
}

export interface GrantWindowExceptionParams {
  actorUserId: string;
  actorRole: RoleName;
  cycleCountWindowId: string;
  reason: string;
  documentType: string;
  ttlMinutes?: number;
}

/**
 * G-08's named-reasoned Supervisor exception — single-use (see
 * assertBranchMovementAllowed's atomic claim), short-lived by default.
 */
export async function grantWindowException(prisma: PrismaClient, params: GrantWindowExceptionParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "cycle-count.window.exception.create" });

  const reason = params.reason?.trim();
  if (!reason) {
    throw new ExceptionReasonRequiredError("A named reason is required to grant a cycle count window exception.");
  }

  const window = await prisma.cycleCountWindow.findUnique({ where: { id: params.cycleCountWindowId } });
  if (!window) throw new CycleCountWindowNotFoundError(params.cycleCountWindowId);
  if (window.status !== "ACTIVE") {
    throw new CycleCountWindowNotActiveError(`Cannot grant an exception against a ${window.status} cycle count window.`);
  }

  const ttlMinutes = params.ttlMinutes ?? DEFAULT_EXCEPTION_TTL_MINUTES;
  return prisma.cycleCountWindowException.create({
    data: {
      cycleCountWindowId: window.id,
      grantedBy: params.actorUserId,
      reason,
      documentType: params.documentType,
      expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
    },
  });
}
