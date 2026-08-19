import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { closeDiscrepancyCase } from "@/server/application/discrepancy/close";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  resolution: z.string().min(1),
});

export const POST = apiHandler<{ caseId: string }>(async (request, { caseId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);

  return closeDiscrepancyCase(prisma, { caseId, actorUserId: actor.userId, actorRole: actor.role, ...body });
});
