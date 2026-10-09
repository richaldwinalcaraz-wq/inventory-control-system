// Shared fixtures for the Daily Reconciliation lifecycle (G-07, G-26). Not
// a finding itself.
import type { PrismaClient } from "@prisma/client";
import { getUserByRole } from "./receiving";

/**
 * A past calendar day (UTC midnight, matching the @db.Date column) with no
 * DailyReconciliation yet for this branch. Checked against the database
 * rather than trusting randomness: the shared test DB keeps every run's rows,
 * so a random pick from a fixed range collides more often with every run.
 */
export async function unusedBusinessDate(prisma: PrismaClient, branchId: string): Promise<Date> {
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (let attempt = 0; attempt < 200; attempt++) {
    const day = new Date(todayUtc - (1 + Math.floor(Math.random() * 20000)) * 86_400_000);
    if (!(await prisma.dailyReconciliation.findFirst({ where: { branchId, businessDate: day }, select: { id: true } }))) return day;
  }
  throw new Error(`No free reconciliation date found for branch ${branchId} after 200 tries.`);
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
      businessDate: params.businessDate ?? (await unusedBusinessDate(prisma, params.branchId)),
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
