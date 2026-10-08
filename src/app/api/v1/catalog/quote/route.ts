import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { parseQuery } from "@/server/http/parseBody";
import { prisma } from "@/lib/prisma";
import { quoteLine } from "@/server/domain/catalog/pricing";

const querySchema = z
  .object({
    variantId: z.string().min(1),
    unitId: z.string().min(1),
    quantity: z.coerce.number().positive().max(1_000_000).multipleOf(0.0001),
    branchId: z.string().min(1).optional(),
    priceList: z.enum(["WHOLESALE", "RETAIL"]).optional(),
  })
  .strict();

/** GET ?variantId&unitId&quantity[&branchId] -> unit price and line total, priced by the server. Any signed-in role. */
export const GET = apiHandler(async (request) => {
  await getCurrentActor();
  const q = parseQuery(request, querySchema);
  return quoteLine(prisma, { productVariantId: q.variantId, unitId: q.unitId, quantity: q.quantity, branchId: q.branchId, priceList: q.priceList });
});
