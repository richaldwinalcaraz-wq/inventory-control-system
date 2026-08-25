import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { requestInterBranchTransfer } from "@/server/application/transfer/request";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  fromBranchId: z.string().min(1),
  productVariantId: z.string().min(1),
  requestedQty: z.number().positive(),
});

// toBranchId is the actor's own branch — a Branch Manager requests a
// transfer INTO their own branch (MB-4: the request itself is the
// receiving-branch approval).
export const POST = apiHandler(async (request) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  if (!actor.branchId) throw new Error("Actor has no branch assigned.");

  return requestInterBranchTransfer(prisma, { ...body, toBranchId: actor.branchId, actorUserId: actor.userId, actorRole: actor.role });
});
