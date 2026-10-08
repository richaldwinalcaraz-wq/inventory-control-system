import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { restoreChildAsin } from "@/server/application/catalog/childAsins";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler<{ variantId: string }>(async (_request, { variantId }) => {
  const actor = await getCurrentActor();
  return restoreChildAsin(prisma, { productVariantId: variantId, actorRole: actor.role, actorUserId: actor.userId });
});
