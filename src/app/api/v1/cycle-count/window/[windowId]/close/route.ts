import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { closeCycleCountWindow } from "@/server/application/cycleCount/window";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler<{ windowId: string }>(async (_request, { windowId }) => {
  const actor = await getCurrentActor();
  return closeCycleCountWindow(prisma, { actorUserId: actor.userId, actorRole: actor.role, cycleCountWindowId: windowId });
});
