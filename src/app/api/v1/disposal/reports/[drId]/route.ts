import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { DamageReportNotFoundError } from "@/server/application/disposal/investigate";
import { prisma } from "@/lib/prisma";

export const GET = apiHandler<{ drId: string }>(async (_request, { drId }) => {
  await getCurrentActor();

  const report = await prisma.damageReport.findUnique({
    where: { id: drId },
    include: {
      productVariant: { select: { sku: true, product: { select: { name: true } } } },
      warehouseLocation: { select: { zone: true, code: true } },
      disposalCertificates: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          disposition: true,
          quantity: true,
          valueAtCost: true,
          status: true,
          forDisposalEnteredAt: true,
          createdAt: true,
        },
      },
    },
  });
  if (!report) throw new DamageReportNotFoundError(drId);

  return report;
});
