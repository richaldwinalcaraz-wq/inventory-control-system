import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { prepareDailyReconciliation } from "@/server/application/reconciliation/prepare";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  businessDate: z.coerce.date(),
  branchId: z.string().min(1).optional(),
});

export const POST = apiHandler(async (request) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  const branchId = body.branchId ?? actor.branchId;
  if (!branchId) throw new Error("branchId is required — this actor has no default branch.");

  return prepareDailyReconciliation(prisma, { actorUserId: actor.userId, actorRole: actor.role, branchId, businessDate: body.businessDate });
});
