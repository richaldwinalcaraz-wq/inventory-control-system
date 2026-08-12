import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { voidSalesOrderRelease } from "@/server/application/wholesale/void";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({ reason: z.string().min(1), pinTokenId: z.string().min(1) });

export const POST = apiHandler<{ releaseId: string }>(async (request, { releaseId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);

  return voidSalesOrderRelease(prisma, {
    releaseId,
    actorUserId: actor.userId,
    actorRole: actor.role,
    reason: body.reason,
    session: actor.session,
    pinTokenId: body.pinTokenId,
  });
});
