import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { submitCycleCountRecount } from "@/server/application/cycleCount/recount";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  countedQty: z.number().nonnegative(),
  completedAt: z.coerce.date().optional(),
  collectedBy: z.string().min(1).optional(),
  submissionMethod: z.enum(["THIRD_PARTY_COLLECTED", "INSTANT_PHOTO_SUBMIT"]).optional(),
});

export const POST = apiHandler<{ recordId: string }>(async (request, { recordId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);

  return submitCycleCountRecount(prisma, { ...body, cycleCountRecordId: recordId, actorUserId: actor.userId, actorRole: actor.role });
});
