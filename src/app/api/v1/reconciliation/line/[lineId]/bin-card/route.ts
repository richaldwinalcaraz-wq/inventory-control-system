import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { saveEvidencePhoto } from "@/server/http/saveEvidencePhoto";
import { submitBinCardCapture } from "@/server/application/reconciliation/captureBinCard";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  binCardQty: z.number().nonnegative(),
  photoDataUrls: z.array(z.string().startsWith("data:image/")).min(1),
});

export const POST = apiHandler<{ lineId: string }>(async (request, { lineId }) => {
  const actor = await getCurrentActor();
  const { photoDataUrls, ...body } = await parseBody(request, bodySchema);

  const storageKeys = await Promise.all(photoDataUrls.map(saveEvidencePhoto));

  return submitBinCardCapture(prisma, {
    ...body,
    lineId,
    actorUserId: actor.userId,
    actorRole: actor.role,
    photos: storageKeys.map((storageKey) => ({ storageKey, captureMethod: "LIVE_CAMERA_STREAM" as const })),
  });
});
