import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { approveInterBranchTransferSending } from "@/server/application/transfer/approveSending";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({ pinTokenId: z.string().min(1) });

export const POST = apiHandler<{ transferId: string }>(async (request, { transferId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  return approveInterBranchTransferSending(prisma, {
    transferId,
    actorUserId: actor.userId,
    actorRole: actor.role,
    session: actor.session,
    pinTokenId: body.pinTokenId,
  });
});
