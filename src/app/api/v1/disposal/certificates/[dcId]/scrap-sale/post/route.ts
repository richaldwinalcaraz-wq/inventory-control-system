import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { postScrapSaleCertificate } from "@/server/application/disposal/scrapSale";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({ pinTokenId: z.string().min(1) });

export const POST = apiHandler<{ dcId: string }>(async (request, { dcId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  if (!actor.branchId) throw new Error("Actor has no branch assigned.");

  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: actor.branchId } });

  return postScrapSaleCertificate(prisma, {
    dcId,
    actorUserId: actor.userId,
    actorRole: actor.role,
    branchCode: branch.code,
    session: actor.session,
    pinTokenId: body.pinTokenId,
  });
});
