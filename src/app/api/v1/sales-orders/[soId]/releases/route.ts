import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { createSalesOrderRelease } from "@/server/application/wholesale/release";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  pinTokenId: z.string().min(1),
  lines: z.array(z.object({ salesOrderLineId: z.string().min(1), qty: z.number().positive() })).min(1),
});

export const POST = apiHandler<{ soId: string }>(async (request, { soId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);

  return createSalesOrderRelease(prisma, {
    salesOrderId: soId,
    actorUserId: actor.userId,
    actorRole: actor.role,
    lines: body.lines,
    session: actor.session,
    pinTokenId: body.pinTokenId,
  });
});

export const GET = apiHandler<{ soId: string }>(async (_request, { soId }) => {
  await getCurrentActor();
  return prisma.salesOrderRelease.findMany({
    where: { salesOrderId: soId },
    orderBy: { createdAt: "desc" },
    include: { lines: true, documentNumber: { select: { fullNumber: true } } },
  });
});
