import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { restoreParentAsin } from "@/server/application/catalog/parentAsins";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler<{ productId: string }>(async (_request, { productId }) => {
  const actor = await getCurrentActor();
  return restoreParentAsin(prisma, { productId, actorRole: actor.role, actorUserId: actor.userId });
});
