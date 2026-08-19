import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { createDamageReport } from "@/server/application/disposal/report";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  productVariantId: z.string().min(1),
  warehouseLocationId: z.string().min(1),
  sourceType: z.enum(["RECEIVING", "STORAGE", "RETURN", "HANDLING"]),
  sourceReferenceType: z.string().min(1).optional(),
  sourceReferenceId: z.string().min(1).optional(),
  quantity: z.number().positive(),
  cause: z.string().min(1),
});

export const POST = apiHandler(async (request) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  if (!actor.branchId) throw new Error("Actor has no branch assigned.");

  return createDamageReport(prisma, {
    ...body,
    actorUserId: actor.userId,
    actorRole: actor.role,
    branchId: actor.branchId,
  });
});

export const GET = apiHandler(async () => {
  const actor = await getCurrentActor();
  if (!actor.branchId) throw new Error("Actor has no branch assigned.");

  return prisma.damageReport.findMany({
    where: { branchId: actor.branchId },
    orderBy: { reportedAt: "desc" },
    take: 50,
    select: {
      id: true,
      sourceType: true,
      quantity: true,
      cause: true,
      status: true,
      quarantineEnteredAt: true,
      reportedAt: true,
      productVariant: { select: { sku: true } },
    },
  });
});
