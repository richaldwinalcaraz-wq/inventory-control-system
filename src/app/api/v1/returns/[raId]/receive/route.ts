import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { recordGoodsReceived } from "@/server/application/returns/receive";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler<{ raId: string }>(async (_request, { raId }) => {
  const actor = await getCurrentActor();

  return recordGoodsReceived(prisma, { raId, actorUserId: actor.userId, actorRole: actor.role });
});
