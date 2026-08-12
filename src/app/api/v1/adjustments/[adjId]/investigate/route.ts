import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { investigateAdjustment } from "@/server/application/adjustment/investigate";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  outcome: z.enum(["PROCEED", "RESOLVED_WITHOUT_ADJUSTMENT"]),
  investigationNotes: z.string().min(1),
});

export const POST = apiHandler<{ adjId: string }>(async (request, { adjId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);

  return investigateAdjustment(prisma, { adjustmentRequestId: adjId, actorUserId: actor.userId, actorRole: actor.role, ...body });
});
