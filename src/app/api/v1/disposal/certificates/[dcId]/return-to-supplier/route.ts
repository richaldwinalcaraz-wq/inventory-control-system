import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { postReturnToSupplierCertificate } from "@/server/application/disposal/returnToSupplier";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  pinTokenId: z.string().min(1),
  vehiclePlate: z.string().min(1).optional(),
  driverName: z.string().min(1).optional(),
});

export const POST = apiHandler<{ dcId: string }>(async (request, { dcId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  if (!actor.branchId) throw new Error("Actor has no branch assigned.");

  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: actor.branchId } });

  return postReturnToSupplierCertificate(prisma, {
    dcId,
    actorUserId: actor.userId,
    actorRole: actor.role,
    branchCode: branch.code,
    vehiclePlate: body.vehiclePlate,
    driverName: body.driverName,
    session: actor.session,
    pinTokenId: body.pinTokenId,
  });
});
