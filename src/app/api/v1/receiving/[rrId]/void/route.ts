import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { voidReceivingReport } from "@/server/application/receiving/void";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({ reason: z.string().min(1) });

export const POST = apiHandler<{ rrId: string }>(async (request, { rrId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  return voidReceivingReport(prisma, { rrId, actorUserId: actor.userId, actorRole: actor.role, reason: body.reason });
});
