import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { approveAdjustment } from "@/server/application/adjustment/approve";
import { prisma } from "@/lib/prisma";

const bodySchema = z
  .object({
    outcome: z.enum(["APPROVE", "REJECT"]),
    pinTokenId: z.string().min(1).optional(),
  })
  .refine((b) => b.outcome !== "APPROVE" || Boolean(b.pinTokenId), { message: "pinTokenId is required to approve.", path: ["pinTokenId"] });

export const POST = apiHandler<{ adjId: string }>(async (request, { adjId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);

  return approveAdjustment(prisma, {
    adjustmentRequestId: adjId,
    actorUserId: actor.userId,
    actorRole: actor.role,
    outcome: body.outcome,
    session: actor.session,
    pinTokenId: body.pinTokenId ?? "",
  });
});
