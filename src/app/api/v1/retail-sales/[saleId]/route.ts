import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { RetailSaleNotFoundError } from "@/server/application/retail/draft";
import { prisma } from "@/lib/prisma";

export const GET = apiHandler<{ saleId: string }>(async (_request, { saleId }) => {
  await getCurrentActor();

  const sale = await prisma.retailSale.findUnique({
    where: { id: saleId },
    include: {
      documentNumber: { select: { fullNumber: true } },
      lines: {
        select: {
          id: true,
          productVariantId: true,
          quantity: true,
          unitPrice: true,
          productVariant: { select: { sku: true, product: { select: { name: true } } } },
        },
      },
    },
  });
  if (!sale) throw new RetailSaleNotFoundError(saleId);

  return sale;
});
