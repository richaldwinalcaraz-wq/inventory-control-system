import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { prisma } from "@/lib/prisma";

export const GET = apiHandler(async () => {
  await getCurrentActor();
  const variants = await prisma.productVariant.findMany({
    where: { status: "ACTIVE" },
    orderBy: { sku: "asc" },
    select: { id: true, sku: true, product: { select: { name: true } } },
  });
  return variants.map((v) => ({ id: v.id, sku: v.sku, productName: v.product.name }));
});
