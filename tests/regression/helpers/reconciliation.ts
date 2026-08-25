// Shared fixtures for the Daily Reconciliation lifecycle (G-07, G-26). Not
// a finding itself.
import type { PrismaClient } from "@prisma/client";
import { getUserByRole } from "./receiving";

/** Spreads fixture businessDates across ~13 years so @@unique([branchId, businessDate]) never collides across repeated suite runs on the same calendar day. */
export function uniqueBusinessDate(): Date {
  return new Date(Date.now() - Math.floor(Math.random() * 5000) * 86400000);
}

export async function createReconciliationLine(
  prisma: PrismaClient,
  params: { branchId: string; variantId: string; systemExpectedClosingQty: number; signedOff?: boolean; businessDate?: Date },
) {
  const auditor = await getUserByRole(prisma, "auditor");
  const location = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId: params.branchId } } });
  const reconciliation = await prisma.dailyReconciliation.create({
    data: {
      branchId: params.branchId,
      businessDate: params.businessDate ?? uniqueBusinessDate(),
      preparedBy: auditor.id,
      ...(params.signedOff ? { signedOffBy: auditor.id, signedOffAt: new Date() } : {}),
    },
  });
  const line = await prisma.dailyReconciliationLine.create({
    data: {
      dailyReconciliationId: reconciliation.id,
      productVariantId: params.variantId,
      warehouseLocationId: location.id,
      openingQty: 0,
      stockInQty: params.systemExpectedClosingQty,
      stockOutQty: 0,
      systemExpectedClosingQty: params.systemExpectedClosingQty,
    },
  });
  return { reconciliation, line };
}
