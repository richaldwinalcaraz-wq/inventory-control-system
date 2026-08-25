import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { getShrinkageRateKpi } from "@/server/application/reporting/shrinkageRate";
import { prisma } from "@/lib/prisma";

export const GET = apiHandler(async () => {
  const actor = await getCurrentActor();
  return getShrinkageRateKpi(prisma, { actorRole: actor.role });
});
