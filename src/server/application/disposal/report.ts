import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

export class CauseRequiredError extends Error {}
export class InvalidDamageQuantityError extends Error {}

export interface CreateDamageReportParams {
  actorUserId: string;
  actorRole: RoleName;
  branchId: string;
  productVariantId: string;
  warehouseLocationId: string;
  sourceType: "RECEIVING" | "STORAGE" | "RETURN" | "HANDLING";
  sourceReferenceType?: string;
  sourceReferenceId?: string;
  quantity: number;
  cause: string;
}

/**
 * DR-1. Mandatory, non-empty cause (G-20's no-fault reporting still
 * requires a real explanation, not a rubber-stamped "Damaged") — same
 * non-empty-before-submit pattern as reconciliationNotes. Deliberately no
 * punitive/disciplinary field anywhere on this model.
 */
export async function createDamageReport(prisma: PrismaClient, params: CreateDamageReportParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "disposal.report.create" });

  const cause = params.cause?.trim();
  if (!cause) throw new CauseRequiredError("A cause is required — 'Damaged' alone is not acceptable.");
  if (!Number.isFinite(params.quantity) || params.quantity <= 0) {
    throw new InvalidDamageQuantityError("quantity must be a positive number.");
  }

  return prisma.damageReport.create({
    data: {
      branchId: params.branchId,
      productVariantId: params.productVariantId,
      warehouseLocationId: params.warehouseLocationId,
      sourceType: params.sourceType,
      sourceReferenceType: params.sourceReferenceType,
      sourceReferenceId: params.sourceReferenceId,
      quantity: params.quantity,
      reportedBy: params.actorUserId,
      cause,
    },
  });
}
