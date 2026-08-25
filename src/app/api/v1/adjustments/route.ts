import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { requestAdjustment } from "@/server/application/adjustment/request";
import { prisma } from "@/lib/prisma";

const REASON_CODES = ["ADJ_01", "ADJ_02", "ADJ_03", "ADJ_04", "ADJ_05", "ADJ_06", "ADJ_07", "ADJ_08", "ADJ_09", "ADJ_10"] as const;

const bodySchema = z.object({
  productVariantId: z.string().min(1),
  warehouseLocationId: z.string().min(1),
  reasonCode: z.enum(REASON_CODES),
  quantityDelta: z.number().refine((n) => n !== 0, "quantityDelta must be non-zero"),
  reconciliationNotes: z.string().min(1),
  damageReportId: z.string().min(1).optional(),
  cycleCountRecordId: z.string().min(1).optional(),
});

export const POST = apiHandler(async (request) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  if (!actor.branchId) throw new Error("Actor has no branch assigned.");

  return requestAdjustment(prisma, { ...body, actorUserId: actor.userId, actorRole: actor.role, branchId: actor.branchId });
});

export const GET = apiHandler(async () => {
  const actor = await getCurrentActor();
  if (!actor.branchId) throw new Error("Actor has no branch assigned.");

  return prisma.adjustmentRequest.findMany({
    where: { branchId: actor.branchId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      reasonCode: true,
      quantityDelta: true,
      value: true,
      status: true,
      requestedBy: true,
      createdAt: true,
      documentNumber: { select: { fullNumber: true } },
      productVariant: { select: { sku: true } },
    },
  });
});
