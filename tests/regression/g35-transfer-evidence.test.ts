// G-35 — A high-value inter-branch transfer must have independent transit
// evidence (waybill/loading photos) reviewed by the Auditor before it can
// close — otherwise "shrinkage in transit" is an easy, unwitnessed place
// to skim stock between two branches' own books.
// SYSTEM RULE: computeTransitEvidenceRequired flags any transfer at or
// above ₱20,000 (frozen at sending-approval time); confirmTransitEvidence
// (AUDITOR-only) requires at least one TransactionEvidence row on file
// before it can set the confirmation; postReceiveInterBranchTransfer hard-
// blocks closing a flagged transfer until that confirmation exists. A
// below-threshold transfer needs none of this — confirmTransitEvidence
// itself refuses to run against it (TransitEvidenceNotRequiredError).
// DETECTION: no transfer-volume-by-branch-pair pattern report exists.
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { postLedgerEntry } from "../../src/server/domain/ledger/postLedgerEntry";
import { computeTransitEvidenceRequired, TRANSIT_EVIDENCE_THRESHOLD_PESOS } from "../../src/server/domain/multibranch/transitEvidence";
import { requestInterBranchTransfer } from "../../src/server/application/transfer/request";
import { approveInterBranchTransferSending, WrongTransferApproverRoleError } from "../../src/server/application/transfer/approveSending";
import { confirmTransitEvidence, TransitEvidenceNotRequiredError, NoTransitEvidenceOnFileError } from "../../src/server/application/transfer/confirmEvidence";
import { postReceiveInterBranchTransfer, TransitEvidenceConfirmationRequiredError } from "../../src/server/application/transfer/close";
import { buildExportTable, UnknownReportIdError } from "../../src/server/application/reporting/export/registry";
import { getIloBranch, getSeedVariant, getUserByRole, createSessionAndPin } from "./helpers/receiving";
import { requestAndApproveSending, driveTransferToArrived } from "./helpers/transfer";

const prisma = new PrismaClient();

describe("G-35: inter-branch transfer transit evidence", () => {
  it("[rule] computeTransitEvidenceRequired flags at/above the ₱20,000 threshold, not below it", () => {
    expect(computeTransitEvidenceRequired(TRANSIT_EVIDENCE_THRESHOLD_PESOS - 0.01)).toBe(false);
    expect(computeTransitEvidenceRequired(TRANSIT_EVIDENCE_THRESHOLD_PESOS)).toBe(true);
    expect(computeTransitEvidenceRequired(TRANSIT_EVIDENCE_THRESHOLD_PESOS + 1)).toBe(true);
  });

  it("[rule] a high-value transfer requires OWNER approval, freezes transitEvidenceRequired=true, and hard-blocks closing until an Auditor confirms evidence on file", async () => {
    const ilo = await getIloBranch(prisma);
    const ceb = await prisma.branch.findUniqueOrThrow({ where: { code: "CEB" } });
    const variant = await getSeedVariant(prisma);
    const branchManager = await getUserByRole(prisma, "branch_manager");
    const auditor = await getUserByRole(prisma, "auditor");

    const location = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId: ilo.id } } });
    const owner0 = await getUserByRole(prisma, "owner");
    const KNOWN_UNIT_COST = 10;
    const AMPLE_QTY = 50000;
    // Establishes fresh, own stock at a KNOWN cost rather than reading
    // whatever getCurrentUnitCost's last-in-cost happens to be right now —
    // that value drifts with every other finding file's own fixture setup
    // (some post at unitCostAtMovement=1), which previously produced a
    // qty (~25,000) that exceeded what was actually available to reserve.
    const tag = `${Date.now()}`;
    await postLedgerEntry(prisma, {
      idempotency: { documentType: "G35SETUP", documentNumber: `G35-SETUP-${tag}`, branchCode: ilo.code, requestPayloadHash: `hash-${tag}` },
      branchId: ilo.id,
      productVariantId: variant.id,
      warehouseLocationId: location.id,
      quantityDeltaBase: AMPLE_QTY,
      movementType: "ADJUSTMENT_IN",
      unitCostAtMovement: KNOWN_UNIT_COST,
      referenceType: "RegressionTestG35",
      referenceId: `g35-setup-${tag}`,
      documentNumber: `G35-SETUP-DOC-${tag}`,
      performedBy: owner0.id,
    });
    const qty = Math.ceil((TRANSIT_EVIDENCE_THRESHOLD_PESOS + 5000) / KNOWN_UNIT_COST);

    // Value comfortably crosses TRANSFER_OUT's own ₱10,000 Owner cutover
    // too, so Branch Manager is the wrong approver for this same reason.
    const { session: sBad, pinToken: pBad } = await createSessionAndPin(prisma, branchManager.id);
    await expect(
      (async () => {
        const transfer = await requestInterBranchTransfer(prisma, { actorUserId: branchManager.id, actorRole: "BRANCH_MANAGER", fromBranchId: ilo.id, toBranchId: ceb.id, productVariantId: variant.id, requestedQty: qty });
        return approveInterBranchTransferSending(prisma, { actorUserId: branchManager.id, actorRole: "BRANCH_MANAGER", transferId: transfer.id, session: sBad, pinTokenId: pBad.id });
      })(),
    ).rejects.toThrow(WrongTransferApproverRoleError);

    const approved = await requestAndApproveSending(prisma, {
      fromBranchId: ilo.id,
      toBranchId: ceb.id,
      variantId: variant.id,
      requestedQty: qty,
      requesterRole: "BRANCH_MANAGER",
      requesterUsername: "branch_manager",
      approverUsername: "owner",
      approverRole: "OWNER",
    });
    expect(approved.transitEvidenceRequired).toBe(true);

    await driveTransferToArrived(prisma, { transferId: approved.id, qty });

    const encoder = await getUserByRole(prisma, "encoder");
    const { session: s1, pinToken: p1 } = await createSessionAndPin(prisma, encoder.id);
    await expect(
      postReceiveInterBranchTransfer(prisma, { actorUserId: encoder.id, actorRole: "ENCODER", transferId: approved.id, session: s1, pinTokenId: p1.id }),
    ).rejects.toThrow(TransitEvidenceConfirmationRequiredError);

    await expect(
      confirmTransitEvidence(prisma, { actorUserId: auditor.id, actorRole: "AUDITOR", transferId: approved.id }),
    ).rejects.toThrow(NoTransitEvidenceOnFileError);

    await prisma.transactionEvidence.create({
      data: { referenceType: "InterBranchTransfer", referenceId: approved.id, storageKey: `g35-waybill-${Date.now()}`, captureMethod: "OTHER", capturedBy: auditor.id },
    });
    const confirmed = await confirmTransitEvidence(prisma, { actorUserId: auditor.id, actorRole: "AUDITOR", transferId: approved.id });
    expect(confirmed.transitEvidenceConfirmedBy).toBe(auditor.id);

    const { session: s2, pinToken: p2 } = await createSessionAndPin(prisma, encoder.id);
    const closed = await postReceiveInterBranchTransfer(prisma, { actorUserId: encoder.id, actorRole: "ENCODER", transferId: approved.id, session: s2, pinTokenId: p2.id });
    expect(closed.status).toBe("RECEIVED_CLOSED");
  });

  it("[rule] a below-threshold transfer needs no evidence — confirmTransitEvidence itself refuses to run, and closing succeeds without it", async () => {
    const ilo = await getIloBranch(prisma);
    const ceb = await prisma.branch.findUniqueOrThrow({ where: { code: "CEB" } });
    const variant = await getSeedVariant(prisma);
    const auditor = await getUserByRole(prisma, "auditor");
    const encoder = await getUserByRole(prisma, "encoder");
    const qty = 1;

    const approved = await requestAndApproveSending(prisma, {
      fromBranchId: ilo.id,
      toBranchId: ceb.id,
      variantId: variant.id,
      requestedQty: qty,
      requesterRole: "BRANCH_MANAGER",
      requesterUsername: "branch_manager",
      approverUsername: "branch_manager",
      approverRole: "BRANCH_MANAGER",
    });
    expect(approved.transitEvidenceRequired).toBe(false);

    await expect(
      confirmTransitEvidence(prisma, { actorUserId: auditor.id, actorRole: "AUDITOR", transferId: approved.id }),
    ).rejects.toThrow(TransitEvidenceNotRequiredError);

    await driveTransferToArrived(prisma, { transferId: approved.id, qty });

    const { session, pinToken } = await createSessionAndPin(prisma, encoder.id);
    const closed = await postReceiveInterBranchTransfer(prisma, { actorUserId: encoder.id, actorRole: "ENCODER", transferId: approved.id, session, pinTokenId: pinToken.id });
    expect(closed.status).toBe("RECEIVED_CLOSED");
  });

  it("[GAP] DETECTION: no transfer-volume-by-branch-pair pattern report exists", async () => {
    try {
      await buildExportTable(prisma, { reportId: "transfer-volume-by-branch-pair", actorRole: "OWNER" });
      throw new Error("[GAP] G-35 FAILED TO STAY A GAP: a transfer-volume-by-branch-pair report now exists in the export registry — replace this test with a real detection test.");
    } catch (err) {
      if (err instanceof UnknownReportIdError) {
        throw new Error(
          "[GAP] G-35 DETECTION: no transfer-volume-by-branch-pair (or similar pattern) report is registered in " +
            "src/server/application/reporting/export/registry.ts — InterBranchTransfer rows are recorded per-transfer " +
            "but never aggregated to surface an unusually heavy or one-directional transfer pattern between two branches.",
        );
      }
      throw err;
    }
  });
});
