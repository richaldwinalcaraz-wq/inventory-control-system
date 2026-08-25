import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { reviewReconciliationLine } from "@/server/application/reconciliation/reviewLine";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler<{ lineId: string }>(async (_request, { lineId }) => {
  const actor = await getCurrentActor();
  return reviewReconciliationLine(prisma, { actorUserId: actor.userId, actorRole: actor.role, lineId });
});
