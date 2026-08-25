import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { checkQuarantineDisposalAging } from "@/server/application/discrepancy/aging";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler(async () => {
  const actor = await getCurrentActor();
  return checkQuarantineDisposalAging(prisma, { actorUserId: actor.userId, actorRole: actor.role });
});
