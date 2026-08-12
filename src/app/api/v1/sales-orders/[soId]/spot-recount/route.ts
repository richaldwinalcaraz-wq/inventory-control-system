import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { submitSpotRecount } from "@/server/application/wholesale/spotRecount";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  lines: z.array(z.object({ productVariantId: z.string().min(1), countedQty: z.number().nonnegative() })).min(1),
});

export const POST = apiHandler<{ soId: string }>(async (request, { soId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  return submitSpotRecount(prisma, { salesOrderId: soId, actorUserId: actor.userId, actorRole: actor.role, lines: body.lines });
});
