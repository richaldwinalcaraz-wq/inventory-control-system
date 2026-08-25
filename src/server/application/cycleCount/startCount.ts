import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

export class NoActiveCycleCountWindowError extends Error {}
export class CycleCountRecordAlreadyOpenError extends Error {}

export interface StartCycleCountRecordParams {
  actorRole: RoleName;
  branchId: string;
  productVariantId: string;
  warehouseLocationId: string;
}

/**
 * A count can only start inside a declared, ACTIVE CycleCountWindow for
 * this branch — starting one outside a window would defeat G-08's whole
 * purpose (the movement freeze exists because a count is in progress).
 * Race-safety against a duplicate open count on the same product+location
 * is the partial unique index (migration ..._open_index), not a lock —
 * this pre-check just gives a friendly error in the common case, same
 * precedent as postOpeningBalance.ts's BR-064 check.
 */
export async function startCycleCountRecord(prisma: PrismaClient, params: StartCycleCountRecordParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "cycle-count.record.start.create" });

  const window = await prisma.cycleCountWindow.findFirst({ where: { branchId: params.branchId, status: "ACTIVE" } });
  if (!window) {
    throw new NoActiveCycleCountWindowError(
      `Branch ${params.branchId} has no active cycle count window — declare one before starting a count.`,
    );
  }

  const productVariant = await prisma.productVariant.findUniqueOrThrow({
    where: { id: params.productVariantId },
    select: { product: { select: { cycleCountClass: true } } },
  });

  const schedule = await prisma.cycleCountSchedule.findUnique({
    where: { branchId_productVariantId: { branchId: params.branchId, productVariantId: params.productVariantId } },
  });

  const alreadyOpen = await prisma.cycleCountRecord.findFirst({
    where: {
      productVariantId: params.productVariantId,
      warehouseLocationId: params.warehouseLocationId,
      status: { notIn: ["CLOSED_CLEAN", "VARIANCE_CONFIRMED"] },
    },
  });
  if (alreadyOpen) {
    throw new CycleCountRecordAlreadyOpenError(
      `A cycle count is already open for this product at this location (record ${alreadyOpen.id}).`,
    );
  }

  try {
    return await prisma.cycleCountRecord.create({
      data: {
        cycleCountWindowId: window.id,
        branchId: params.branchId,
        productVariantId: params.productVariantId,
        warehouseLocationId: params.warehouseLocationId,
        cycleCountClass: productVariant.product.cycleCountClass,
        cycleCountScheduleId: schedule?.id,
      },
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      throw new CycleCountRecordAlreadyOpenError(
        "A cycle count was started for this product at this location by a concurrent request.",
      );
    }
    throw err;
  }
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2002";
}
