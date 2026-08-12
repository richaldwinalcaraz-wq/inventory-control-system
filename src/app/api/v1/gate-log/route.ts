import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { logGateEntry } from "@/server/application/receiving/gate";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  direction: z.enum(["IN", "OUT"]),
  referenceType: z.string().optional(),
  referenceId: z.string().optional(),
  vehiclePlate: z.string().optional(),
  driverName: z.string().optional(),
});

export const POST = apiHandler(async (request) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  if (!actor.branchId) throw new Error("Actor has no branch assigned.");

  return logGateEntry(prisma, { ...body, actorUserId: actor.userId, actorRole: actor.role, branchId: actor.branchId });
});
