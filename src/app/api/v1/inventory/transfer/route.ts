import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { transferIntraBranch } from "@/server/application/inventory/transfer";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  productVariantId: z.string().min(1),
  quantity: z.number().positive(),
  pinTokenId: z.string().min(1),
});

/** Intra-branch relocation — Storage -> Counter replenishment today (BPD sec.8.1). */
export const POST = apiHandler(async (request) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  if (!actor.branchId) throw new Error("Actor has no branch assigned.");

  return transferIntraBranch(prisma, {
    branchId: actor.branchId,
    productVariantId: body.productVariantId,
    quantity: body.quantity,
    actorUserId: actor.userId,
    actorRole: actor.role,
    session: actor.session,
    pinTokenId: body.pinTokenId,
  });
});
