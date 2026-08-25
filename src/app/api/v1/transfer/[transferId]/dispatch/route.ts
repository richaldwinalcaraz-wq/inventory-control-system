import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { dispatchInterBranchTransfer } from "@/server/application/transfer/dispatch";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  pinTokenId: z.string().min(1),
  vehiclePlate: z.string().min(1).optional(),
  driverName: z.string().min(1).optional(),
});

export const POST = apiHandler<{ transferId: string }>(async (request, { transferId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  return dispatchInterBranchTransfer(prisma, {
    ...body,
    transferId,
    actorUserId: actor.userId,
    actorRole: actor.role,
    session: actor.session,
  });
});
