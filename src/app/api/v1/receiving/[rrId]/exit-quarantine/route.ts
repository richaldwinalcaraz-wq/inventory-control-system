import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { exitQuarantine } from "@/server/application/receiving/inspection";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler<{ rrId: string }>(async (_request, { rrId }) => {
  const actor = await getCurrentActor();
  return exitQuarantine(prisma, { rrId, actorUserId: actor.userId, actorRole: actor.role });
});
