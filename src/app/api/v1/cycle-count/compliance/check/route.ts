import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { checkCycleCountCompliance } from "@/server/application/cycleCount/compliance";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler(async () => {
  const actor = await getCurrentActor();
  return checkCycleCountCompliance(prisma, { actorUserId: actor.userId, actorRole: actor.role });
});
