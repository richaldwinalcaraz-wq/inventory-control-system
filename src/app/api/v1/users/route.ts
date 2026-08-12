import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { prisma } from "@/lib/prisma";

/** Active users at the caller's branch — used for pickers like the tie-break witness. */
export const GET = apiHandler(async () => {
  const actor = await getCurrentActor();
  if (!actor.branchId) throw new Error("Actor has no branch assigned.");

  return prisma.user.findMany({
    where: { branchId: actor.branchId, status: "ACTIVE" },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, role: true },
  });
});
