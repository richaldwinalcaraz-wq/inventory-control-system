import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { recordGateCheck } from "@/server/application/wholesale/gateCheck";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  sealNumber: z.string().min(1),
  sealVerifiedIntact: z.boolean(),
  actualWeightKg: z.number().positive(),
  vehiclePlate: z.string().optional(),
  driverName: z.string().optional(),
});

export const POST = apiHandler<{ releaseId: string }>(async (request, { releaseId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  return recordGateCheck(prisma, { releaseId, actorUserId: actor.userId, actorRole: actor.role, ...body });
});
