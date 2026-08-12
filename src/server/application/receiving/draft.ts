import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

export class ReceivingReportNotFoundError extends Error {}
export class InvalidReceivingReportStateError extends Error {}

export interface DraftReceivingReportParams {
  actorUserId: string;
  actorRole: RoleName;
  branchId: string;
  supplierId: string;
  drNumber: string;
  poReference?: string;
  gateLogEntryId?: string;
  lines: Array<{ productVariantId: string; expectedQty?: number; unitCost: number }>;
}

/** Steps 2–3 — unloading + document verification, captured as one draft RR. */
export async function draftReceivingReport(prisma: PrismaClient, params: DraftReceivingReportParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "receiving.draft.create" });

  return prisma.receivingReport.create({
    data: {
      branchId: params.branchId,
      supplierId: params.supplierId,
      drNumber: params.drNumber,
      poReference: params.poReference,
      gateLogEntryId: params.gateLogEntryId,
      receivedBy: params.actorUserId,
      status: "DRAFT",
      lines: {
        create: params.lines.map((l) => ({
          productVariantId: l.productVariantId,
          expectedQty: l.expectedQty,
          unitCost: l.unitCost,
        })),
      },
    },
    include: { lines: true },
  });
}

export interface ConfirmSupplierCallbackParams {
  actorUserId: string;
  actorRole: RoleName;
  rrId: string;
}

/**
 * G-04: for a no-PO or above-threshold delivery, the office must call the
 * supplier back on the number ON FILE (never a number taken from the
 * delivery paperwork itself) before Step 9 approval is allowed to
 * proceed. This just records that the callback happened; the actual
 * phone call is a human, off-system action.
 */
export async function confirmSupplierCallback(prisma: PrismaClient, params: ConfirmSupplierCallbackParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "receiving.callback.confirm" });

  const rr = await prisma.receivingReport.findUnique({ where: { id: params.rrId } });
  if (!rr) throw new ReceivingReportNotFoundError(params.rrId);
  if (rr.status === "POSTED" || rr.status === "VOID") {
    throw new InvalidReceivingReportStateError(`Cannot confirm a supplier callback on a ${rr.status} receiving report.`);
  }

  return prisma.receivingReport.update({
    where: { id: params.rrId },
    data: { supplierCallbackConfirmedAt: new Date() },
  });
}
