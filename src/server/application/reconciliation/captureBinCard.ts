import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

export class DailyReconciliationLineNotFoundError extends Error {}
export class AlreadySignedOffError extends Error {}
export class BinCardPhotoRequiredError extends Error {}

export interface SubmitBinCardCaptureParams {
  actorUserId: string;
  actorRole: RoleName;
  lineId: string;
  binCardQty: number;
  /** G-07: bound, numbered, photographed bin-card — at least one live capture is mandatory, no file picker. */
  photos: Array<{ storageKey: string; captureMethod: "LIVE_CAMERA_STREAM" | "OTHER" }>;
}

/**
 * Records the physical bin-card count against the already-prepared system
 * figure and computes variance/matched. Reuses TransactionEvidence +
 * CameraCapture.tsx exactly as every other evidence requirement in this
 * codebase — no new capture mechanism.
 */
export async function submitBinCardCapture(prisma: PrismaClient, params: SubmitBinCardCaptureParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "reconciliation.bin-card.capture.create" });

  const hasLivePhoto = params.photos.some((p) => p.captureMethod === "LIVE_CAMERA_STREAM");
  if (!hasLivePhoto) {
    throw new BinCardPhotoRequiredError("A live-captured bin-card photo is required (G-07).");
  }

  const line = await prisma.dailyReconciliationLine.findUnique({
    where: { id: params.lineId },
    include: { dailyReconciliation: true },
  });
  if (!line) throw new DailyReconciliationLineNotFoundError(params.lineId);
  if (line.dailyReconciliation.signedOffBy) {
    throw new AlreadySignedOffError("Cannot capture a bin card once the day's reconciliation is signed off.");
  }

  const variance = params.binCardQty - Number(line.systemExpectedClosingQty);
  const matched = variance === 0;

  return prisma.$transaction(async (tx) => {
    for (const photo of params.photos) {
      await tx.transactionEvidence.create({
        data: {
          referenceType: "DailyReconciliationLine",
          referenceId: line.id,
          storageKey: photo.storageKey,
          captureMethod: photo.captureMethod,
          capturedBy: params.actorUserId,
        },
      });
    }

    return tx.dailyReconciliationLine.update({
      where: { id: line.id },
      data: { binCardQty: params.binCardQty, variance, matched },
    });
  });
}
