import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { prisma } from "@/lib/prisma";
import { confirmPackSize } from "@/server/application/catalog/sellingUnits";

/** One physical check of a pending pack size. The second check by a different person activates it. */
export const POST = apiHandler<{ conversionRateVersionId: string }>(async (_request, { conversionRateVersionId }) => {
  const actor = await getCurrentActor();
  return confirmPackSize(prisma, { conversionRateVersionId, actorRole: actor.role, actorUserId: actor.userId });
});
