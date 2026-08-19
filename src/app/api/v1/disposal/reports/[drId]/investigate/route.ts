import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { recordCauseInvestigation } from "@/server/application/disposal/investigate";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler<{ drId: string }>(async (_request, { drId }) => {
  const actor = await getCurrentActor();

  return recordCauseInvestigation(prisma, {
    damageReportId: drId,
    actorUserId: actor.userId,
    actorRole: actor.role,
  });
});
