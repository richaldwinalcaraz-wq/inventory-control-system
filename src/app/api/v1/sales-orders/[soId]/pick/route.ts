import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { pickSalesOrder } from "@/server/application/wholesale/pick";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  lines: z.array(z.object({ salesOrderLineId: z.string().min(1), pickedQty: z.number().nonnegative() })).min(1),
});

export const POST = apiHandler<{ soId: string }>(async (request, { soId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  return pickSalesOrder(prisma, { salesOrderId: soId, actorUserId: actor.userId, actorRole: actor.role, lines: body.lines });
});
