import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { confirmSupplierCallback } from "@/server/application/receiving/draft";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler<{ rrId: string }>(async (_request, { rrId }) => {
  const actor = await getCurrentActor();
  return confirmSupplierCallback(prisma, { rrId, actorUserId: actor.userId, actorRole: actor.role });
});
