import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { recordTransferReceive } from "@/server/application/transfer/receiveCount";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({ countedQty: z.number().nonnegative() });

export const POST = apiHandler<{ transferId: string }>(async (request, { transferId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  return recordTransferReceive(prisma, { ...body, transferId, actorUserId: actor.userId, actorRole: actor.role });
});
