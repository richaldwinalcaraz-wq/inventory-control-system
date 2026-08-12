import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { approveReceivingReport } from "@/server/application/receiving/approval";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({ pinTokenId: z.string().min(1) });

export const POST = apiHandler<{ rrId: string }>(async (request, { rrId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  return approveReceivingReport(prisma, {
    rrId,
    actorUserId: actor.userId,
    actorRole: actor.role,
    session: actor.session,
    pinTokenId: body.pinTokenId,
  });
});
