import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { prisma } from "@/lib/prisma";
import { setPriceSchema } from "@/server/http/catalogSchemas";
import { setVariantPrice } from "@/server/application/catalog/sellingUnits";

/** Sets a variant's price in one unit (Owner). The previous price is kept as history. */
export const POST = apiHandler<{ variantId: string }>(async (request, { variantId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, setPriceSchema);
  return setVariantPrice(prisma, { ...body, productVariantId: variantId, actorRole: actor.role, actorUserId: actor.userId });
});
