import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { createProduct } from "@/server/application/inventory/createProduct";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  name: z.string().min(1),
  categoryId: z.string().min(1).nullable().optional(),
  baseUnitId: z.string().min(1),
  unitWeightKg: z.number().positive().nullable().optional(),
  cycleCountClass: z.enum(["A", "B", "C"]).optional(),
  sku: z.string().min(1),
  barcode: z.string().min(1).nullable().optional(),
  sellingPrice: z.number().positive(),
});

export const POST = apiHandler(async (request) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);

  return createProduct(prisma, { ...body, actorUserId: actor.userId, actorRole: actor.role });
});
