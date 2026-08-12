import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { recordPodReturn } from "@/server/application/wholesale/pod";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler<{ releaseId: string }>(async (_request, { releaseId }) => {
  const actor = await getCurrentActor();
  return recordPodReturn(prisma, { releaseId, actorUserId: actor.userId, actorRole: actor.role });
});
