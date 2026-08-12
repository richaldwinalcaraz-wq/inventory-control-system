import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { submitTieBreakCount } from "@/server/application/receiving/counting";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  witnessedBy: z.string().min(1),
  lines: z.array(z.object({ productVariantId: z.string().min(1), countedQty: z.number().nonnegative() })).min(1),
});

export const POST = apiHandler<{ rrId: string }>(async (request, { rrId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  return submitTieBreakCount(prisma, { rrId, actorUserId: actor.userId, actorRole: actor.role, witnessedBy: body.witnessedBy, lines: body.lines });
});
