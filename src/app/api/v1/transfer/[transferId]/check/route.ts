import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { recordTransferCheck } from "@/server/application/transfer/check";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({ checkedQty: z.number().nonnegative() });

// Blind — this response must never be shaped to include the pick count,
// same discipline as wholesale's checkSalesOrder route.
export const POST = apiHandler<{ transferId: string }>(async (request, { transferId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  return recordTransferCheck(prisma, { ...body, transferId, actorUserId: actor.userId, actorRole: actor.role });
});
