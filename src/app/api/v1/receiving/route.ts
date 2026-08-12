import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { draftReceivingReport } from "@/server/application/receiving/draft";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  supplierId: z.string().min(1),
  drNumber: z.string().min(1),
  poReference: z.string().optional(),
  gateLogEntryId: z.string().optional(),
  lines: z
    .array(
      z.object({
        productVariantId: z.string().min(1),
        expectedQty: z.number().positive().optional(),
        unitCost: z.number().nonnegative(),
      }),
    )
    .min(1),
});

export const POST = apiHandler(async (request) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  if (!actor.branchId) throw new Error("Actor has no branch assigned.");

  return draftReceivingReport(prisma, { ...body, actorUserId: actor.userId, actorRole: actor.role, branchId: actor.branchId });
});

export const GET = apiHandler(async () => {
  const actor = await getCurrentActor();
  if (!actor.branchId) throw new Error("Actor has no branch assigned.");

  return prisma.receivingReport.findMany({
    where: { branchId: actor.branchId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      drNumber: true,
      poReference: true,
      status: true,
      createdAt: true,
      supplier: { select: { name: true } },
      documentNumber: { select: { fullNumber: true } },
    },
  });
});
