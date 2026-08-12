import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { verifyReceivingReport } from "@/server/application/receiving/verification";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler<{ rrId: string }>(async (_request, { rrId }) => {
  const actor = await getCurrentActor();
  return verifyReceivingReport(prisma, { rrId, actorUserId: actor.userId, actorRole: actor.role });
});
