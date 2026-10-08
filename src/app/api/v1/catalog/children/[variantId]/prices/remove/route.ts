import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { prisma } from "@/lib/prisma";
import { removePriceSchema } from "@/server/http/catalogSchemas";
import { removeVariantPrice } from "@/server/application/catalog/sellingUnits";

/** Stops selling a variant in one unit (Owner). History is kept. */
export const POST = apiHandler<{ variantId: string }>(async (request, { variantId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, removePriceSchema);
  return removeVariantPrice(prisma, { ...body, productVariantId: variantId, actorRole: actor.role, actorUserId: actor.userId });
});
