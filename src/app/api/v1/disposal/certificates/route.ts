import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { createDisposalCertificate } from "@/server/application/disposal/createCertificate";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  damageReportId: z.string().min(1),
  disposition: z.enum(["DESTROY", "SCRAP_SALE", "RETURN_TO_SUPPLIER", "SELL_AS_SECONDS"]),
  quantity: z.number().positive(),
  witness1Id: z.string().min(1),
  witness2Id: z.string().min(1),
});

export const POST = apiHandler(async (request) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);

  return createDisposalCertificate(prisma, {
    ...body,
    actorUserId: actor.userId,
    actorRole: actor.role,
  });
});
