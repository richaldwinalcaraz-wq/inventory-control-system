import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { assignDiscrepancyCase } from "@/server/application/discrepancy/assign";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  assignedTo: z.string().min(1),
});

export const POST = apiHandler<{ caseId: string }>(async (request, { caseId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);

  return assignDiscrepancyCase(prisma, { caseId, actorRole: actor.role, ...body });
});
