import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { DisposalCertificateNotFoundError } from "@/server/application/disposal/destroy";
import { prisma } from "@/lib/prisma";

export const GET = apiHandler<{ dcId: string }>(async (_request, { dcId }) => {
  await getCurrentActor();

  const cert = await prisma.disposalCertificate.findUnique({
    where: { id: dcId },
    include: {
      damageReport: {
        select: { id: true, quantity: true, cause: true, productVariant: { select: { sku: true, product: { select: { name: true } } } } },
      },
      documentNumber: { select: { fullNumber: true } },
      scrapSaleRecord: true,
    },
  });
  if (!cert) throw new DisposalCertificateNotFoundError(dcId);

  return cert;
});
