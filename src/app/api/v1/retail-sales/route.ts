import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { draftRetailSale } from "@/server/application/retail/draft";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  lines: z
    .array(
      z.object({
        productVariantId: z.string().min(1),
        quantity: z.number().positive(),
      }),
    )
    .min(1),
});

export const POST = apiHandler(async (request) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  if (!actor.branchId) throw new Error("Actor has no branch assigned.");

  return draftRetailSale(prisma, { ...body, actorUserId: actor.userId, actorRole: actor.role, branchId: actor.branchId });
});

export const GET = apiHandler(async () => {
  const actor = await getCurrentActor();
  if (!actor.branchId) throw new Error("Actor has no branch assigned.");

  return prisma.retailSale.findMany({
    where: { branchId: actor.branchId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      createdAt: true,
      documentNumber: { select: { fullNumber: true } },
      lines: { select: { quantity: true, unitPrice: true, productVariant: { select: { sku: true } } } },
    },
  });
});
