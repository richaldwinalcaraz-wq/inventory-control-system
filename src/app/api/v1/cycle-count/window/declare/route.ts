import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { declareCycleCountWindow } from "@/server/application/cycleCount/window";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  // Optional: Owner/Auditor have no default branch (they span branches),
  // so they must name one explicitly; branch-scoped staff can omit it.
  branchId: z.string().min(1).optional(),
  notes: z.string().optional(),
});

export const POST = apiHandler(async (request) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  const branchId = body.branchId ?? actor.branchId;
  if (!branchId) throw new Error("branchId is required — this actor has no default branch.");

  return declareCycleCountWindow(prisma, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    branchId,
    notes: body.notes,
  });
});
