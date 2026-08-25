import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { checkDeactivatedUserOpenItems } from "@/server/application/discrepancy/deactivatedUsers";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler(async () => {
  const actor = await getCurrentActor();
  return checkDeactivatedUserOpenItems(prisma, { actorUserId: actor.userId, actorRole: actor.role });
});
