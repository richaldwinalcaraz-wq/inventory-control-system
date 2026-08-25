import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { grantWindowException } from "@/server/application/cycleCount/window";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  reason: z.string().min(1),
  documentType: z.enum(["PICKING_LIST", "RECEIVING_REPORT"]),
  ttlMinutes: z.number().positive().optional(),
});

export const POST = apiHandler<{ windowId: string }>(async (request, { windowId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);

  return grantWindowException(prisma, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    cycleCountWindowId: windowId,
    reason: body.reason,
    documentType: body.documentType,
    ttlMinutes: body.ttlMinutes,
  });
});
