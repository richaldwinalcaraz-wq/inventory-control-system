import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { reserveSalesOrder } from "@/server/application/wholesale/reserve";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler<{ soId: string }>(async (_request, { soId }) => {
  const actor = await getCurrentActor();
  return reserveSalesOrder(prisma, { salesOrderId: soId, actorUserId: actor.userId, actorRole: actor.role });
});
