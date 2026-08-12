import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { AdjustmentRequestNotFoundError } from "@/server/application/adjustment/request";
import { prisma } from "@/lib/prisma";

export const GET = apiHandler<{ adjId: string }>(async (_request, { adjId }) => {
  await getCurrentActor();

  const req = await prisma.adjustmentRequest.findUnique({
    where: { id: adjId },
    include: {
      documentNumber: { select: { fullNumber: true } },
      productVariant: { select: { sku: true, product: { select: { name: true } } } },
      warehouseLocation: { select: { code: true, zone: true } },
    },
  });
  if (!req) throw new AdjustmentRequestNotFoundError(adjId);

  return req;
});
