import type { DisposalDisposition, PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { getCurrentUnitCost } from "../../domain/ledger/currentUnitCost";
import { lockDamageReportDisposalRow, computeRemainingUndisposedQty } from "../../domain/disposal/disposalLock";
import { DamageReportNotFoundError } from "./investigate";

export class ExceedsUndisposedQtyError extends Error {}
export class WitnessMustNotBeWarehouseRoleError extends Error {}
export class SameWitnessError extends Error {}
export class InvalidCertificateQuantityError extends Error {}

const WAREHOUSE_ROLES: readonly RoleName[] = ["WAREHOUSE_SUPERVISOR", "WAREHOUSE_RECEIVER", "WAREHOUSE_PICKER", "WAREHOUSE_CHECKER"];

export interface CreateDisposalCertificateParams {
  actorUserId: string;
  actorRole: RoleName;
  damageReportId: string;
  disposition: DisposalDisposition;
  quantity: number;
  witness1Id: string;
  witness2Id: string;
}

/**
 * DC-1. Locks DamageReportDisposalLock and validates against the report's
 * remaining-undisposed quantity — the third concurrency fix, same
 * discipline as ReturnQuantityLock. witness2 is server-checked to not be a
 * warehouse role (BR's two-witness requirement is meant to bring in an
 * independent perspective, not a second warehouse staffer).
 */
export async function createDisposalCertificate(prisma: PrismaClient, params: CreateDisposalCertificateParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "disposal.certificate.create" });

  if (!Number.isFinite(params.quantity) || params.quantity <= 0) {
    throw new InvalidCertificateQuantityError("quantity must be a positive number.");
  }
  if (params.witness1Id === params.witness2Id) {
    throw new SameWitnessError("The two witnesses must be different people.");
  }

  return prisma.$transaction(async (tx) => {
    const report = await tx.damageReport.findUnique({ where: { id: params.damageReportId } });
    if (!report) throw new DamageReportNotFoundError(params.damageReportId);

    const witness2 = await tx.user.findUnique({ where: { id: params.witness2Id } });
    if (!witness2 || WAREHOUSE_ROLES.includes(witness2.role)) {
      throw new WitnessMustNotBeWarehouseRoleError("The second witness must not hold a warehouse role — an independent perspective is required.");
    }

    await lockDamageReportDisposalRow(tx, { damageReportId: report.id });
    const remaining = await computeRemainingUndisposedQty(tx, { damageReportId: report.id, totalQty: Number(report.quantity) });
    if (remaining < params.quantity) {
      throw new ExceedsUndisposedQtyError(`Requested ${params.quantity} exceeds the ${remaining} still undisposed on this report.`);
    }

    const unitCost = await getCurrentUnitCost(tx, { productVariantId: report.productVariantId, warehouseLocationId: report.warehouseLocationId });
    const valueAtCost = params.quantity * Number(unitCost);

    return tx.disposalCertificate.create({
      data: {
        damageReportId: report.id,
        disposition: params.disposition,
        decidedBy: params.actorUserId,
        quantity: params.quantity,
        valueAtCost,
        witness1Id: params.witness1Id,
        witness2Id: params.witness2Id,
      },
    });
  });
}
