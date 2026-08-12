import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { voidAdjustment } from "@/server/application/adjustment/void";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({ reason: z.string().min(1) });

export const POST = apiHandler<{ adjId: string }>(async (request, { adjId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);

  return voidAdjustment(prisma, { adjustmentRequestId: adjId, actorUserId: actor.userId, actorRole: actor.role, reason: body.reason });
});
