import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { checkCountWindowViolations } from "@/server/application/cycleCount/violation";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler<{ windowId: string }>(async (_request, { windowId }) => {
  const actor = await getCurrentActor();
  return checkCountWindowViolations(prisma, { actorUserId: actor.userId, actorRole: actor.role, cycleCountWindowId: windowId });
});
