import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { parseBody } from "@/server/http/parseBody";
import { getCurrentActor } from "@/server/http/currentActor";
import { saveEvidencePhoto } from "@/server/http/saveEvidencePhoto";
import { recordScrapSaleQuote } from "@/server/application/disposal/scrapSale";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  buyerId: z.string().min(1).optional(),
  buyerName: z.string().min(1),
  pricePerKg: z.number().positive(),
  weightKg: z.number().positive(),
  quotesOnFile: z.array(z.object({ buyerName: z.string().min(1), pricePerKg: z.number().positive() })).optional(),
  quoteEvidencePhotoDataUrls: z.array(z.string().startsWith("data:image/")).default([]),
  scrapBuyerBenchmarkId: z.string().min(1).optional(),
});

export const POST = apiHandler<{ dcId: string }>(async (request, { dcId }) => {
  const actor = await getCurrentActor();
  const { quoteEvidencePhotoDataUrls, ...body } = await parseBody(request, bodySchema);

  const storageKeys = await Promise.all(quoteEvidencePhotoDataUrls.map(saveEvidencePhoto));

  return recordScrapSaleQuote(prisma, {
    ...body,
    dcId,
    actorUserId: actor.userId,
    actorRole: actor.role,
    quoteEvidencePhotos: storageKeys.map((storageKey) => ({ storageKey, captureMethod: "LIVE_CAMERA_STREAM" as const })),
  });
});
