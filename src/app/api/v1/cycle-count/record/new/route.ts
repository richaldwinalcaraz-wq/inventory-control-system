import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { startCycleCountRecord } from "@/server/application/cycleCount/startCount";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  productVariantId: z.string().min(1),
  warehouseLocationId: z.string().min(1),
});

export const POST = apiHandler(async (request) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  if (!actor.branchId) throw new Error("Actor has no branch assigned.");

  return startCycleCountRecord(prisma, { ...body, actorRole: actor.role, branchId: actor.branchId });
});
