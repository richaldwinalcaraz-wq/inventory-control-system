import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

export class SalesOrderReleaseNotFoundError extends Error {}
export class InvalidReleaseStateError extends Error {}

export interface RecordGateCheckParams {
  actorUserId: string;
  actorRole: RoleName;
  releaseId: string;
  sealNumber: string;
  sealVerifiedIntact: boolean;
  actualWeightKg: number;
  vehiclePlate?: string;
  driverName?: string;
}

/**
 * PENDING_GATE_CHECK -> RELEASED. Guard-recorded physical exit check —
 * weightCheckPassed is computed here against the band set at release
 * creation (Product.unitWeightKg-derived), and is a hard precondition the
 * post step re-asserts rather than trusting this status alone.
 */
export async function recordGateCheck(prisma: PrismaClient, params: RecordGateCheckParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "wholesale.gate-check.create" });

  const release = await prisma.salesOrderRelease.findUnique({ where: { id: params.releaseId } });
  if (!release) throw new SalesOrderReleaseNotFoundError(params.releaseId);
  if (release.status !== "PENDING_GATE_CHECK") {
    throw new InvalidReleaseStateError(`Cannot record a gate check for a release that is ${release.status} — it must be PENDING_GATE_CHECK.`);
  }

  const min = release.expectedWeightMinKg ? Number(release.expectedWeightMinKg) : null;
  const max = release.expectedWeightMaxKg ? Number(release.expectedWeightMaxKg) : null;
  const weightCheckPassed = min !== null && max !== null && params.actualWeightKg >= min && params.actualWeightKg <= max;

  return prisma.$transaction(async (tx) => {
    const gateLog = await tx.gateLogEntry.create({
      data: {
        branchId: (await tx.salesOrder.findUniqueOrThrow({ where: { id: release.salesOrderId }, select: { branchId: true } })).branchId,
        direction: "OUT",
        referenceType: "SalesOrderRelease",
        referenceId: release.id,
        vehiclePlate: params.vehiclePlate,
        driverName: params.driverName,
        loggedBy: params.actorUserId,
      },
    });

    return tx.salesOrderRelease.update({
      where: { id: release.id },
      data: {
        sealNumber: params.sealNumber,
        sealVerifiedIntact: params.sealVerifiedIntact,
        actualWeightKg: params.actualWeightKg,
        weightCheckPassed,
        gateLogEntryOutId: gateLog.id,
        status: "RELEASED",
      },
    });
  });
}
