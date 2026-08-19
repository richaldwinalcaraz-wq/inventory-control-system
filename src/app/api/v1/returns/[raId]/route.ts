import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { ReturnAuthorizationNotFoundError } from "@/server/application/returns/receive";
import { prisma } from "@/lib/prisma";

export const GET = apiHandler<{ raId: string }>(async (_request, { raId }) => {
  await getCurrentActor();

  const ra = await prisma.returnAuthorization.findUnique({
    where: { id: raId },
    include: {
      documentNumber: { select: { fullNumber: true } },
      productVariant: { select: { sku: true, product: { select: { name: true } } } },
    },
  });
  if (!ra) throw new ReturnAuthorizationNotFoundError(raId);

  return ra;
});
