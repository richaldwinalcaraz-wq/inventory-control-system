import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { signOffDailyReconciliation } from "@/server/application/reconciliation/signOff";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler<{ reconciliationId: string }>(async (_request, { reconciliationId }) => {
  const actor = await getCurrentActor();
  return signOffDailyReconciliation(prisma, { actorUserId: actor.userId, actorRole: actor.role, dailyReconciliationId: reconciliationId });
});
