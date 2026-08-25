import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { recordTransferPick } from "@/server/application/transfer/pick";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({ pickedQty: z.number().positive() });

export const POST = apiHandler<{ transferId: string }>(async (request, { transferId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  return recordTransferPick(prisma, { ...body, transferId, actorUserId: actor.userId, actorRole: actor.role });
});
