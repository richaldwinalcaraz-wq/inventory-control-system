// G-18 — Destruction of unsellable stock must be photo-documented, and
// that evidence must actually be on file at posting time, not merely
// trusted from an earlier step that could have been silently bypassed or
// had its evidence go missing.
// SYSTEM RULE (BR-062): recordDestructionEvidence requires a live-captured
// photo to move DRAFT -> FOR_DISPOSAL; postDestroyCertificate RE-CHECKS
// that evidence exists at posting time rather than trusting the earlier
// status transition alone.
// DETECTION: no reused/duplicate-image flagging exists — the same
// storageKey could be reused across unrelated destructions with nothing
// noticing.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createDamageReport } from "../../src/server/application/disposal/report";
import { createDisposalCertificate } from "../../src/server/application/disposal/createCertificate";
import { recordDestructionEvidence, postDestroyCertificate, DestructionEvidenceRequiredError } from "../../src/server/application/disposal/destroy";
import { getIloBranch, getSeedVariant, getUserByRole, createSessionAndPin } from "./helpers/receiving";

const prisma = new PrismaClient();

async function draftDestroyCertificate(branchId: string, variantId: string, qty: number) {
  const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
  const auditor = await getUserByRole(prisma, "auditor");
  const location = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId } } });

  const report = await createDamageReport(prisma, {
    actorUserId: supervisor.id,
    actorRole: "WAREHOUSE_SUPERVISOR",
    branchId,
    productVariantId: variantId,
    warehouseLocationId: location.id,
    sourceType: "STORAGE",
    quantity: qty,
    cause: "G-18 test: unsellable, headed for destruction.",
  });

  const cert = await createDisposalCertificate(prisma, {
    actorUserId: supervisor.id,
    actorRole: "WAREHOUSE_SUPERVISOR",
    damageReportId: report.id,
    disposition: "DESTROY",
    quantity: qty,
    witness1Id: supervisor.id,
    witness2Id: auditor.id,
  });

  return { report, cert, supervisor };
}

describe("G-18: destruction evidence, re-checked at posting", () => {
  it("[rule] recordDestructionEvidence requires at least one live-captured photo", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const { cert, supervisor } = await draftDestroyCertificate(branch.id, variant.id, 1);

    await expect(
      recordDestructionEvidence(prisma, { actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", dcId: cert.id, evidencePhotos: [] }),
    ).rejects.toThrow(DestructionEvidenceRequiredError);

    await expect(
      recordDestructionEvidence(prisma, {
        actorUserId: supervisor.id,
        actorRole: "WAREHOUSE_SUPERVISOR",
        dcId: cert.id,
        evidencePhotos: [{ storageKey: `g18-bad-${Date.now()}`, captureMethod: "OTHER" }],
      }),
    ).rejects.toThrow(DestructionEvidenceRequiredError);
  });

  it("[rule] postDestroyCertificate re-checks evidence at posting time — evidence going missing after FOR_DISPOSAL still blocks the post", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const { cert, supervisor } = await draftDestroyCertificate(branch.id, variant.id, 1);

    await recordDestructionEvidence(prisma, {
      actorUserId: supervisor.id,
      actorRole: "WAREHOUSE_SUPERVISOR",
      dcId: cert.id,
      evidencePhotos: [{ storageKey: `g18-evidence-${Date.now()}`, captureMethod: "LIVE_CAMERA_STREAM" }],
    });

    // Simulate the evidence having gone missing after the earlier step —
    // BR-062 says posting must re-check, not just trust FOR_DISPOSAL status.
    await prisma.transactionEvidence.deleteMany({ where: { referenceType: "DisposalCertificate", referenceId: cert.id } });

    const { session, pinToken } = await createSessionAndPin(prisma, supervisor.id);
    await expect(
      postDestroyCertificate(prisma, { actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", branchCode: branch.code, dcId: cert.id, session, pinTokenId: pinToken.id }),
    ).rejects.toThrow(DestructionEvidenceRequiredError);
  });

  it("[rule] with evidence genuinely on file, posting succeeds and marks the damage report DISPOSED once fully covered", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const { report, cert, supervisor } = await draftDestroyCertificate(branch.id, variant.id, 2);

    await recordDestructionEvidence(prisma, {
      actorUserId: supervisor.id,
      actorRole: "WAREHOUSE_SUPERVISOR",
      dcId: cert.id,
      evidencePhotos: [{ storageKey: `g18-evidence-${Date.now()}`, captureMethod: "LIVE_CAMERA_STREAM" }],
    });

    const { session, pinToken } = await createSessionAndPin(prisma, supervisor.id);
    const posted = await postDestroyCertificate(prisma, { actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", branchCode: branch.code, dcId: cert.id, session, pinTokenId: pinToken.id });
    expect(posted.disposalCertificate.status).toBe("POSTED");

    const refreshedReport = await prisma.damageReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(refreshedReport.status).toBe("DISPOSED");
  });

  it("[GAP] DETECTION: no reused/duplicate-image flagging exists for destruction evidence", () => {
    const disposalDir = fileURLToPath(new URL("../../src/server/application/disposal", import.meta.url));
    const combined = readdirSync(disposalDir).map((f) => readFileSync(`${disposalDir}/${f}`, "utf-8")).join("\n");
    if (/duplicate/i.test(combined)) {
      throw new Error("[GAP] G-18 FAILED TO STAY A GAP: disposal application code now references duplicate-detection — replace this test with a real detection test.");
    }
    throw new Error(
      "[GAP] G-18 DETECTION: no code anywhere in src/server/application/disposal checks whether a TransactionEvidence " +
        "storageKey has been reused across unrelated destructions (or reused from an earlier, different disposal " +
        "entirely) — the same photo could be resubmitted to satisfy the evidence gate with nothing noticing.",
    );
  });
});
