import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { voidSalesOrder } from "@/server/application/wholesale/void";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({ reason: z.string().min(1) });

export const POST = apiHandler<{ soId: string }>(async (request, { soId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  return voidSalesOrder(prisma, { salesOrderId: soId, actorUserId: actor.userId, actorRole: actor.role, reason: body.reason });
});
