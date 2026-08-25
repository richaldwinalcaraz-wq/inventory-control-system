import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { parseBusinessDateParam } from "@/server/http/businessDate";
import { dispatchDailyExceptionReport } from "@/server/application/reporting/deliverExceptionReport";
import { prisma } from "@/lib/prisma";

export const GET = apiHandler(async (request) => {
  const actor = await getCurrentActor();
  const businessDate = parseBusinessDateParam(request.nextUrl.searchParams.get("date"));
  return dispatchDailyExceptionReport(prisma, { actorUserId: actor.userId, actorRole: actor.role, businessDate });
});
