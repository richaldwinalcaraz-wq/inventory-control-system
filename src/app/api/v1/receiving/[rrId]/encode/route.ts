import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { saveEvidencePhoto } from "@/server/http/saveEvidencePhoto";
import { encodeReceivingReport } from "@/server/application/receiving/encoding";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  pinTokenId: z.string().min(1),
  // Base64 data URLs captured by the in-page getUserMedia() canvas
  // component — never a file-picker upload. See saveEvidencePhoto for
  // the local-dev storage driver.
  evidencePhotoDataUrls: z.array(z.string().startsWith("data:image/")).min(1),
});

export const POST = apiHandler<{ rrId: string }>(async (request, { rrId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);
  if (!actor.branchId) throw new Error("Actor has no branch assigned.");

  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: actor.branchId } });
  const storageKeys = await Promise.all(body.evidencePhotoDataUrls.map(saveEvidencePhoto));

  return encodeReceivingReport(prisma, {
    rrId,
    actorUserId: actor.userId,
    actorRole: actor.role,
    branchCode: branch.code,
    session: actor.session,
    pinTokenId: body.pinTokenId,
    evidencePhotos: storageKeys.map((storageKey) => ({ storageKey, captureMethod: "LIVE_CAMERA_STREAM" as const })),
  });
});
