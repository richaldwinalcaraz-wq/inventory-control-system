import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { resolveAsin } from "@/server/domain/catalog/asin";
import { CatalogRecordNotFoundError } from "@/server/application/catalog/shared";
import { prisma } from "@/lib/prisma";

/** GET ?asin=B0CHILD001 (or a child SKU) -> its Child -> Parent -> Product context. Any signed-in role. */
export const GET = apiHandler(async (request) => {
  await getCurrentActor();
  const asin = request.nextUrl.searchParams.get("asin")?.trim();
  if (!asin) throw new CatalogRecordNotFoundError("Pass ?asin= to resolve.");
  const resolved = await resolveAsin(prisma, asin);
  if (!resolved) throw new CatalogRecordNotFoundError(`No parent or child matches "${asin}".`);
  return resolved;
});
