import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { getCycleCountComplianceKpi } from "@/server/application/reporting/cycleCountCompliance";
import { prisma } from "@/lib/prisma";

export const GET = apiHandler(async () => {
  const actor = await getCurrentActor();
  return getCycleCountComplianceKpi(prisma, { actorRole: actor.role });
});
