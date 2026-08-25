import type { Prisma, PrismaClient, RoleName, CycleCountClass } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

const CLASS_INTERVAL_DAYS: Record<CycleCountClass, number> = { A: 7, B: 30, C: 90 };

function computeNextDueAt(cycleCountClass: CycleCountClass, from: Date): Date {
  const days = CLASS_INTERVAL_DAYS[cycleCountClass];
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Called by evaluate.ts (CLOSED_CLEAN) and recount.ts (VARIANCE_CONFIRMED)
 * alike — in both outcomes the item WAS physically counted on time, it just
 * may also have revealed a variance needing investigation. The schedule's
 * only job is tracking "was it counted," not "was it clean," so both
 * callers reset the same fields identically.
 */
export async function markCycleCountScheduleCounted(
  tx: Prisma.TransactionClient,
  params: { cycleCountScheduleId: string; cycleCountClass: CycleCountClass },
): Promise<void> {
  const now = new Date();
  await tx.cycleCountSchedule.update({
    where: { id: params.cycleCountScheduleId },
    data: {
      lastCountedAt: now,
      nextDueAt: computeNextDueAt(params.cycleCountClass, now),
      consecutiveMisses: 0,
      forcedAuditorRecount: false,
      status: "ON_SCHEDULE",
    },
  });
}

export interface GenerateCycleCountScheduleParams {
  actorRole: RoleName;
  branchId: string;
}

/**
 * G-25 scheduling. On-demand (no BullMQ — same checkOverduePodReturns
 * precedent), idempotent via CycleCountSchedule's @@unique([branchId,
 * productVariantId]): a row is created once per (branch, variant) that has
 * ever carried stock at that branch, then only its cycleCountClass snapshot
 * is refreshed on later runs — nextDueAt/status/lastCountedAt/
 * consecutiveMisses are never reset by regeneration.
 */
export async function generateCycleCountSchedule(prisma: PrismaClient, params: GenerateCycleCountScheduleParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "cycle-count.schedule.generate.create" });

  const balances = await prisma.stockBalance.findMany({
    where: { warehouseLocation: { warehouse: { branchId: params.branchId } } },
    select: {
      productVariantId: true,
      productVariant: { select: { createdAt: true, product: { select: { cycleCountClass: true } } } },
    },
    distinct: ["productVariantId"],
  });

  const results = [];
  for (const b of balances) {
    const cycleCountClass = b.productVariant.product.cycleCountClass;
    results.push(
      await prisma.cycleCountSchedule.upsert({
        where: { branchId_productVariantId: { branchId: params.branchId, productVariantId: b.productVariantId } },
        update: { cycleCountClass },
        create: {
          branchId: params.branchId,
          productVariantId: b.productVariantId,
          cycleCountClass,
          nextDueAt: computeNextDueAt(cycleCountClass, b.productVariant.createdAt),
        },
      }),
    );
  }
  return results;
}
