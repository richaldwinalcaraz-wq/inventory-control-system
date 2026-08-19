import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { issueReturnAuthorization } from "@/server/application/returns/authorize";
import { prisma } from "@/lib/prisma";

const REASON_CODES = [
  "WRONG_ITEM",
  "WRONG_SIZE_GAUGE",
  "DAMAGED_ON_DELIVERY",
  "DEFECTIVE",
  "OVER_DELIVERED",
  "CUSTOMER_CANCELLED",
  "UNSOLD_STOCK_RETURN",
] as const;

const bodySchema = z.object({
  originalSaleType: z.enum(["RetailSale", "SalesOrder"]),
  originalSaleLineId: z.string().min(1),
  requestedQty: z.number().positive(),
  reasonCode: z.enum(REASON_CODES),
  identityVerification: z.enum(["PHYSICAL_RECEIPT", "MATCHED_IDENTITY", "NONE"]),
  verifiedIdName: z.string().min(1).optional(),
  verifiedIdContact: z.string().min(1).optional(),
  pinTokenId: z.string().min(1),
});

export const POST = apiHandler(async (request) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  if (!actor.branchId) throw new Error("Actor has no branch assigned.");

  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: actor.branchId } });

  return issueReturnAuthorization(prisma, {
    ...body,
    actorUserId: actor.userId,
    actorRole: actor.role,
    branchId: actor.branchId,
    branchCode: branch.code,
    session: actor.session,
  });
});

export const GET = apiHandler(async () => {
  const actor = await getCurrentActor();
  if (!actor.branchId) throw new Error("Actor has no branch assigned.");

  return prisma.returnAuthorization.findMany({
    where: { branchId: actor.branchId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      originalSaleType: true,
      reasonCode: true,
      requestedQty: true,
      status: true,
      isHighRisk: true,
      createdAt: true,
      documentNumber: { select: { fullNumber: true } },
      productVariant: { select: { sku: true } },
    },
  });
});
