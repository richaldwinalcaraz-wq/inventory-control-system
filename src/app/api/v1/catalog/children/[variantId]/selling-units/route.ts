import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { prisma } from "@/lib/prisma";
import { addSellingUnitSchema } from "@/server/http/catalogSchemas";
import { addSellingUnit } from "@/server/application/catalog/sellingUnits";

/** Adds a selling unit — its pack size (pending until checked) and price — in one step (Owner). */
export const POST = apiHandler<{ variantId: string }>(async (request, { variantId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, addSellingUnitSchema);
  return addSellingUnit(prisma, { ...body, productVariantId: variantId, actorRole: actor.role, actorUserId: actor.userId });
});
