import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { setReorderPoint } from "@/server/application/inventory/reorderPoints";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  productVariantId: z.string().min(1),
  reorderPoint: z.number().nonnegative().nullable(),
});

export const POST = apiHandler(async (request) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);

  return setReorderPoint(prisma, { ...body, actorUserId: actor.userId, actorRole: actor.role });
});
