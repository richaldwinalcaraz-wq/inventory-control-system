import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { voidDisposalCertificate } from "@/server/application/disposal/void";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({ reason: z.string().min(1) });

export const POST = apiHandler<{ dcId: string }>(async (request, { dcId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);

  return voidDisposalCertificate(prisma, {
    dcId,
    actorUserId: actor.userId,
    actorRole: actor.role,
    reason: body.reason,
  });
});
