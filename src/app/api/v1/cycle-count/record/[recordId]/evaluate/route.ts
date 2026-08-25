import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { evaluateCycleCountVariance } from "@/server/application/cycleCount/evaluate";
import { prisma } from "@/lib/prisma";

export const POST = apiHandler<{ recordId: string }>(async (_request, { recordId }) => {
  const actor = await getCurrentActor();
  return evaluateCycleCountVariance(prisma, { actorRole: actor.role, cycleCountRecordId: recordId });
});
