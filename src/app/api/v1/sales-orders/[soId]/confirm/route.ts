import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { confirmSalesOrder } from "@/server/application/wholesale/order";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler<{ soId: string }>(async (_request, { soId }) => {
  const actor = await getCurrentActor();
  return confirmSalesOrder(prisma, { salesOrderId: soId, actorUserId: actor.userId, actorRole: actor.role });
});
