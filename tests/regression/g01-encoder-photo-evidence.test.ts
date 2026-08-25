// G-01 — The Encoder is a trusted single point of truth with no independent check.
// SYSTEM RULE (BR-093): no stock-affecting transaction may post without a live-
// captured photo of its signed source document.
// DETECTION: a weekly Auditor sample comparing typed qty vs. photographed qty —
// NOT IMPLEMENTED (no OCR/extracted-total field exists anywhere in the schema).
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { encodeReceivingReport, LivePhotoRequiredError } from "../../src/server/application/receiving/encoding";
import { getUserByRole, getIloBranch, getSeedVariant, createSessionAndPin, draftAndPrepareForApproval, advanceToApproved, cleanupReceivingReports } from "./helpers/receiving";

const prisma = new PrismaClient();
const createdRrIds: string[] = [];

async function buildApprovedRr() {
  const branch = await getIloBranch(prisma);
  const variant = await getSeedVariant(prisma);
  const rr = await draftAndPrepareForApproval(prisma, { branchId: branch.id, variantId: variant.id });
  await advanceToApproved(prisma, rr.id);
  createdRrIds.push(rr.id);
  return { rr, branch };
}

describe("G-01: encoder photo evidence", () => {
  it("[rule] blocks posting with zero evidence photos", async () => {
    const { rr, branch } = await buildApprovedRr();
    const encoder = await getUserByRole(prisma, "encoder");
    const { session, pinToken } = await createSessionAndPin(prisma, encoder.id);

    await expect(
      encodeReceivingReport(prisma, {
        rrId: rr.id,
        actorUserId: encoder.id,
        actorRole: "ENCODER",
        branchCode: branch.code,
        session,
        pinTokenId: pinToken.id,
        evidencePhotos: [],
      }),
    ).rejects.toThrow(LivePhotoRequiredError);
  });

  it("[rule] blocks posting with a non-live (gallery-style) evidence photo", async () => {
    const { rr, branch } = await buildApprovedRr();
    const encoder = await getUserByRole(prisma, "encoder");
    const { session, pinToken } = await createSessionAndPin(prisma, encoder.id);

    await expect(
      encodeReceivingReport(prisma, {
        rrId: rr.id,
        actorUserId: encoder.id,
        actorRole: "ENCODER",
        branchCode: branch.code,
        session,
        pinTokenId: pinToken.id,
        evidencePhotos: [{ storageKey: "fake-gallery-upload.jpg", captureMethod: "OTHER" }],
      }),
    ).rejects.toThrow(LivePhotoRequiredError);
  });

  it("[rule] allows posting once a genuine live-captured photo is attached", async () => {
    const { rr, branch } = await buildApprovedRr();
    const encoder = await getUserByRole(prisma, "encoder");
    const { session, pinToken } = await createSessionAndPin(prisma, encoder.id);

    const result = await encodeReceivingReport(prisma, {
      rrId: rr.id,
      actorUserId: encoder.id,
      actorRole: "ENCODER",
      branchCode: branch.code,
      session,
      pinTokenId: pinToken.id,
      evidencePhotos: [{ storageKey: "live-capture-001.jpg", captureMethod: "LIVE_CAMERA_STREAM" }],
    });
    expect(result.receivingReport.status).toBe("POSTED");
  });

  it("[GAP] DETECTION: no weekly typed-vs-photographed-quantity comparison exists", () => {
    throw new Error(
      "[GAP] G-01 DETECTION: no OCR/extracted-document-total field exists anywhere in the schema, and no " +
        "weekly Auditor sample-audit function exists in src/server/application — the attached photo is stored " +
        "(TransactionEvidence) but never programmatically compared against the typed quantity.",
    );
  });
});

afterAll(async () => {
  // StockLedger is permanent and hash-chained (G-27) — never deleted, by
  // design, matching the real system's own append-only invariant. Every
  // other row created here (RR, its lines, CountSlips, TransactionEvidence)
  // is self-contained with a timestamp-unique drNumber, so leftover rows
  // from a prior run don't collide with a fresh one; cleaned up anyway to
  // keep the test DB tidy, but this is housekeeping, not correctness.
  await cleanupReceivingReports(prisma, createdRrIds);
  await prisma.$disconnect();
});
