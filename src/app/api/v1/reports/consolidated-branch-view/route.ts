import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { getConsolidatedBranchStockView } from "@/server/application/reporting/consolidatedBranchView";
import { prisma } from "@/lib/prisma";

export const GET = apiHandler(async () => {
  const actor = await getCurrentActor();
  return getConsolidatedBranchStockView(prisma, { actorRole: actor.role });
});
