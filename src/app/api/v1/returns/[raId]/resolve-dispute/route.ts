import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { resolveGradingDisagreement } from "@/server/application/returns/resolveDisagreement";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({ finalGrade: z.enum(["SELLABLE", "REPACKABLE", "DAMAGED", "NOT_OURS"]) });

export const POST = apiHandler<{ raId: string }>(async (request, { raId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);

  return resolveGradingDisagreement(prisma, { raId, actorUserId: actor.userId, actorRole: actor.role, ...body });
});
