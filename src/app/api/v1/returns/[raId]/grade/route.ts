import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { saveEvidencePhoto } from "@/server/http/saveEvidencePhoto";
import { submitReturnGrading } from "@/server/application/returns/grade";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  grade: z.enum(["SELLABLE", "REPACKABLE", "DAMAGED", "NOT_OURS"]),
  notes: z.string().min(1).optional(),
  evidencePhotoDataUrls: z.array(z.string().startsWith("data:image/")).default([]),
});

export const POST = apiHandler<{ raId: string }>(async (request, { raId }) => {
  const actor = await getCurrentActor();
  const body = await parseBody(request, bodySchema);

  const storageKeys = await Promise.all(body.evidencePhotoDataUrls.map(saveEvidencePhoto));

  return submitReturnGrading(prisma, {
    raId,
    actorUserId: actor.userId,
    actorRole: actor.role,
    grade: body.grade,
    notes: body.notes,
    evidencePhotos: storageKeys.map((storageKey) => ({ storageKey, captureMethod: "LIVE_CAMERA_STREAM" as const })),
  });
});
