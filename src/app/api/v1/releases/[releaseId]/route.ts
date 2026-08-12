import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { prisma } from "@/lib/prisma";

export const GET = apiHandler<{ releaseId: string }>(async (_request, { releaseId }) => {
  await getCurrentActor();
  return prisma.salesOrderRelease.findUniqueOrThrow({
    where: { id: releaseId },
    include: {
      lines: { include: { salesOrderLine: { include: { productVariant: { select: { sku: true } } } } } },
      documentNumber: { select: { fullNumber: true } },
      salesOrder: { select: { id: true, branchId: true, customer: { select: { name: true } } } },
    },
  });
});
