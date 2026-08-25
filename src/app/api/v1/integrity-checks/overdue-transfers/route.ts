import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { checkOverdueTransfers } from "@/server/application/discrepancy/overdueTransfers";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler(async () => {
  const actor = await getCurrentActor();
  return checkOverdueTransfers(prisma, { actorUserId: actor.userId, actorRole: actor.role });
});
