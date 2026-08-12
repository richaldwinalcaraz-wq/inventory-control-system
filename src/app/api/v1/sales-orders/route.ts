import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { draftSalesOrder } from "@/server/application/wholesale/order";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  customerId: z.string().min(1),
  requestedDeliveryDate: z.string().datetime().optional(),
  lines: z.array(z.object({ productVariantId: z.string().min(1), orderedQty: z.number().positive() })).min(1),
});

export const POST = apiHandler(async (request) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  if (!actor.branchId) throw new Error("Actor has no branch assigned.");

  return draftSalesOrder(prisma, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    branchId: actor.branchId,
    customerId: body.customerId,
    requestedDeliveryDate: body.requestedDeliveryDate ? new Date(body.requestedDeliveryDate) : undefined,
    lines: body.lines,
  });
});

export const GET = apiHandler(async () => {
  const actor = await getCurrentActor();
  if (!actor.branchId) throw new Error("Actor has no branch assigned.");

  return prisma.salesOrder.findMany({
    where: { branchId: actor.branchId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      createdAt: true,
      customer: { select: { name: true } },
      lines: { select: { orderedQty: true, unitPrice: true, productVariant: { select: { sku: true } } } },
    },
  });
});
