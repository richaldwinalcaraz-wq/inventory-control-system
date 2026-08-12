import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { submitInspection } from "@/server/application/receiving/inspection";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  outcome: z.enum(["PASS", "REJECT"]),
  rejectedProductVariantIds: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export const POST = apiHandler<{ rrId: string }>(async (request, { rrId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  return submitInspection(prisma, { rrId, actorUserId: actor.userId, actorRole: actor.role, ...body });
});
