import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { requestRetailSaleVoidWithoutReturn } from "@/server/application/retail/voidWithoutReturn";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({ reason: z.string().min(1) });

export const POST = apiHandler<{ saleId: string }>(async (request, { saleId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);

  return requestRetailSaleVoidWithoutReturn(prisma, {
    retailSaleId: saleId,
    actorUserId: actor.userId,
    actorRole: actor.role,
    reason: body.reason,
  });
});
