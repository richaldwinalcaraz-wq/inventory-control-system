import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { confirmTransitEvidence } from "@/server/application/transfer/confirmEvidence";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler<{ transferId: string }>(async (_request, { transferId }) => {
  const actor = await getCurrentActor();
  return confirmTransitEvidence(prisma, { transferId, actorUserId: actor.userId, actorRole: actor.role });
});
