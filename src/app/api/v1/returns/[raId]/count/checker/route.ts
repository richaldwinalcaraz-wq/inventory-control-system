import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { submitReturnCheckCount } from "@/server/application/returns/count";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({ countedQty: z.number().nonnegative() });

export const POST = apiHandler<{ raId: string }>(async (request, { raId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);

  return submitReturnCheckCount(prisma, { raId, actorUserId: actor.userId, actorRole: actor.role, ...body });
});
