import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { updateParentSchema } from "@/server/http/catalogSchemas";
import { updateParentAsin } from "@/server/application/catalog/parentAsins";
import { prisma } from "@/lib/prisma";

export const PATCH = apiHandler<{ productId: string }>(async (request, { productId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, updateParentSchema);
  return updateParentAsin(prisma, { ...body, productId, actorRole: actor.role, actorUserId: actor.userId });
});
