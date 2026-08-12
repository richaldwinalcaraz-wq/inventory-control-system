import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { prisma } from "@/lib/prisma";

export const GET = apiHandler<{ soId: string }>(async (_request, { soId }) => {
  await getCurrentActor();

  const order = await prisma.salesOrder.findUniqueOrThrow({
    where: { id: soId },
    include: {
      customer: { select: { name: true } },
      lines: { include: { productVariant: { select: { sku: true } } } },
      releases: { select: { id: true, status: true, sealNumber: true, actualWeightKg: true, weightCheckPassed: true, sealVerifiedIntact: true } },
    },
  });

  // Blind-check constraint: while a checker's recount is actively pending
  // (STAGED), pickedQty must never appear in what a checker could read —
  // mirrors Receiving's checker route omitting the receiver's figures.
  // Once the order has moved past STAGED (checked, one way or another),
  // it's safe to show both for review.
  const lines = order.lines.map((l) => ({
    id: l.id,
    productVariantId: l.productVariantId,
    sku: l.productVariant.sku,
    orderedQty: l.orderedQty,
    pickedQty: order.status === "STAGED" ? null : l.pickedQty,
    checkedQty: l.checkedQty,
    releasedQty: l.releasedQty,
    unitPrice: l.unitPrice,
  }));

  return { ...order, lines };
});
