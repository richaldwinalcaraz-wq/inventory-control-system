import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { authorizeSalesOrderRelease } from "@/server/application/wholesale/authorizeRelease";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler<{ soId: string }>(async (_request, { soId }) => {
  const actor = await getCurrentActor();
  return authorizeSalesOrderRelease(prisma, { salesOrderId: soId, actorUserId: actor.userId, actorRole: actor.role });
});
