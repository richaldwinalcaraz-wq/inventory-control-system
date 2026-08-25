import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { generateCycleCountSchedule } from "@/server/application/cycleCount/schedule";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  branchId: z.string().min(1).optional(),
});

export const POST = apiHandler(async (request) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  const branchId = body.branchId ?? actor.branchId;
  if (!branchId) throw new Error("branchId is required — this actor has no default branch.");

  return generateCycleCountSchedule(prisma, { actorRole: actor.role, branchId });
});
