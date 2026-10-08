import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { prisma } from "@/lib/prisma";
import { rejectPackSizeSchema } from "@/server/http/catalogSchemas";
import { rejectPackSize } from "@/server/application/catalog/sellingUnits";

/** Records a physical check that found a different count; the Owner re-proposes the right number. */
export const POST = apiHandler<{ conversionRateVersionId: string }>(async (request, { conversionRateVersionId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, rejectPackSizeSchema);
  return rejectPackSize(prisma, { ...body, conversionRateVersionId, actorRole: actor.role, actorUserId: actor.userId });
});
