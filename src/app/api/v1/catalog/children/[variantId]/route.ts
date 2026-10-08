import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { updateChildSchema } from "@/server/http/catalogSchemas";
import { updateChildAsin } from "@/server/application/catalog/childAsins";
import { prisma } from "@/lib/prisma";

export const PATCH = apiHandler<{ variantId: string }>(async (request, { variantId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, updateChildSchema);
  return updateChildAsin(prisma, { ...body, productVariantId: variantId, actorRole: actor.role, actorUserId: actor.userId });
});
