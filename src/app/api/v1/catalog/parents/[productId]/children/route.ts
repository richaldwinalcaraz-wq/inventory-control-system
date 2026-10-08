import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { addChildSchema } from "@/server/http/catalogSchemas";
import { addChildAsin } from "@/server/application/catalog/childAsins";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler<{ productId: string }>(async (request, { productId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, addChildSchema);
  return addChildAsin(prisma, { ...body, parentProductId: productId, actorRole: actor.role, actorUserId: actor.userId });
});
