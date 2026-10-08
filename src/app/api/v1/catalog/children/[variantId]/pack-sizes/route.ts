import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { prisma } from "@/lib/prisma";
import { proposePackSizeSchema } from "@/server/http/catalogSchemas";
import { proposePackSize } from "@/server/application/catalog/sellingUnits";

/** Proposes "1 unit = N base units" (Owner). Pending until two other people check it. */
export const POST = apiHandler<{ variantId: string }>(async (request, { variantId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, proposePackSizeSchema);
  return proposePackSize(prisma, { ...body, productVariantId: variantId, actorRole: actor.role, actorUserId: actor.userId });
});
