import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { parseQuery } from "@/server/http/parseBody";
import { prisma } from "@/lib/prisma";
import { getProductMaster } from "@/server/application/catalog/productMaster";

const querySchema = z.object({ branchId: z.string().min(1).optional(), priceList: z.enum(["WHOLESALE", "RETAIL"]).optional() }).strict();

/** GET [?branchId] -> products -> variants -> selling units, prices, pack sizes and stock. The Order App's product source. Any signed-in role. */
export const GET = apiHandler(async (request) => {
  await getCurrentActor();
  const q = parseQuery(request, querySchema);
  return getProductMaster(prisma, q);
});
