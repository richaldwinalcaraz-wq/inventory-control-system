import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { prisma } from "@/lib/prisma";

export const GET = apiHandler(async () => {
  await getCurrentActor();
  return prisma.supplier.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, contactPhone: true },
  });
});
