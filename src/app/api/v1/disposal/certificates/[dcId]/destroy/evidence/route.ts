import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { saveEvidencePhoto } from "@/server/http/saveEvidencePhoto";
import { recordDestructionEvidence } from "@/server/application/disposal/destroy";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  evidencePhotoDataUrls: z.array(z.string().startsWith("data:image/")).min(1),
});

export const POST = apiHandler<{ dcId: string }>(async (request, { dcId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);

  const storageKeys = await Promise.all(body.evidencePhotoDataUrls.map(saveEvidencePhoto));

  return recordDestructionEvidence(prisma, {
    dcId,
    actorUserId: actor.userId,
    actorRole: actor.role,
    evidencePhotos: storageKeys.map((storageKey) => ({ storageKey, captureMethod: "LIVE_CAMERA_STREAM" as const })),
  });
});
