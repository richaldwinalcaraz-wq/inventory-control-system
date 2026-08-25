// G-07 — A bin card is easy to falsify after the fact ("wrote down what
// the system says") unless the physical count is captured live, in the
// moment, against a card that can't be quietly re-copied.
// SYSTEM RULE: submitBinCardCapture requires at least one live-captured
// photo (BinCardPhotoRequiredError otherwise); computes variance/matched
// against the reconciliation's systemExpectedClosingQty; blocked once the
// day's reconciliation is already signed off.
// NOTE (not a gap): the audit finding's own physical "bound, pre-numbered
// ledger book" half has no software analogue to build or test against —
// there's no BinCard database model, deliberately, because a physical
// booklet isn't a system artifact. The photo-evidence requirement above IS
// the software-side control; this is confirmed structurally below rather
// than asserted as a missing feature.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { submitBinCardCapture, BinCardPhotoRequiredError, AlreadySignedOffError } from "../../src/server/application/reconciliation/captureBinCard";
import { getIloBranch, getSeedVariant, getUserByRole } from "./helpers/receiving";

const prisma = new PrismaClient();

function uniqueBusinessDate(): Date {
  // Spreads fixture businessDates across ~13 years so @@unique([branchId,
  // businessDate]) never collides across repeated suite runs on the same
  // calendar day.
  return new Date(Date.now() - Math.floor(Math.random() * 5000) * 86400000);
}

async function createReconciliationLine(branchId: string, variantId: string, systemExpectedClosingQty: number, signedOff = false) {
  const auditor = await getUserByRole(prisma, "auditor");
  const location = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId } } });
  const reconciliation = await prisma.dailyReconciliation.create({
    data: {
      branchId,
      businessDate: uniqueBusinessDate(),
      preparedBy: auditor.id,
      ...(signedOff ? { signedOffBy: auditor.id, signedOffAt: new Date() } : {}),
    },
  });
  const line = await prisma.dailyReconciliationLine.create({
    data: {
      dailyReconciliationId: reconciliation.id,
      productVariantId: variantId,
      warehouseLocationId: location.id,
      openingQty: 0,
      stockInQty: systemExpectedClosingQty,
      stockOutQty: 0,
      systemExpectedClosingQty,
    },
  });
  return { reconciliation, line };
}

describe("G-07: bin card live-photo evidence", () => {
  it("[rule] submitBinCardCapture requires at least one live-captured photo", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const receiver = await getUserByRole(prisma, "warehouse_receiver");
    const { line } = await createReconciliationLine(branch.id, variant.id, 100);

    await expect(
      submitBinCardCapture(prisma, { actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", lineId: line.id, binCardQty: 100, photos: [] }),
    ).rejects.toThrow(BinCardPhotoRequiredError);

    await expect(
      submitBinCardCapture(prisma, {
        actorUserId: receiver.id,
        actorRole: "WAREHOUSE_RECEIVER",
        lineId: line.id,
        binCardQty: 100,
        photos: [{ storageKey: `g07-bad-${Date.now()}`, captureMethod: "OTHER" }],
      }),
    ).rejects.toThrow(BinCardPhotoRequiredError);
  });

  it("[rule] with a live photo, the capture succeeds and computes variance/matched against systemExpectedClosingQty", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const receiver = await getUserByRole(prisma, "warehouse_receiver");
    const { line } = await createReconciliationLine(branch.id, variant.id, 100);

    const matched = await submitBinCardCapture(prisma, {
      actorUserId: receiver.id,
      actorRole: "WAREHOUSE_RECEIVER",
      lineId: line.id,
      binCardQty: 100,
      photos: [{ storageKey: `g07-evidence-${Date.now()}`, captureMethod: "LIVE_CAMERA_STREAM" }],
    });
    expect(Number(matched.variance)).toBe(0);
    expect(matched.matched).toBe(true);

    const { line: line2 } = await createReconciliationLine(branch.id, variant.id, 100);
    const mismatched = await submitBinCardCapture(prisma, {
      actorUserId: receiver.id,
      actorRole: "WAREHOUSE_RECEIVER",
      lineId: line2.id,
      binCardQty: 92,
      photos: [{ storageKey: `g07-evidence-${Date.now()}`, captureMethod: "LIVE_CAMERA_STREAM" }],
    });
    expect(Number(mismatched.variance)).toBe(-8);
    expect(mismatched.matched).toBe(false);
  });

  it("[rule] a bin card cannot be captured once the day's reconciliation is already signed off", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const receiver = await getUserByRole(prisma, "warehouse_receiver");
    const { line } = await createReconciliationLine(branch.id, variant.id, 100, true);

    await expect(
      submitBinCardCapture(prisma, {
        actorUserId: receiver.id,
        actorRole: "WAREHOUSE_RECEIVER",
        lineId: line.id,
        binCardQty: 100,
        photos: [{ storageKey: `g07-evidence-${Date.now()}`, captureMethod: "LIVE_CAMERA_STREAM" }],
      }),
    ).rejects.toThrow(AlreadySignedOffError);
  });

  it("confirms there is deliberately no BinCard database model — the physical bound ledger book has no software analogue; the photo-evidence requirement above is the actual software-side control", () => {
    const schemaPath = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url));
    const content = readFileSync(schemaPath, "utf-8");
    expect(/model BinCard\b/.test(content)).toBe(false);
  });
});
