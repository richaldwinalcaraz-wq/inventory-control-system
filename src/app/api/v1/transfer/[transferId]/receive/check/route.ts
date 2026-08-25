import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { recordTransferReceiveCheck } from "@/server/application/transfer/receiveCount";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({ countedQty: z.number().nonnegative() });

// Blind — this response must never be shaped to include the receiver's figure.
export const POST = apiHandler<{ transferId: string }>(async (request, { transferId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  return recordTransferReceiveCheck(prisma, { ...body, transferId, actorUserId: actor.userId, actorRole: actor.role });
});
