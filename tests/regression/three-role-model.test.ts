// Three-role model (src/lib/roleModel.ts, client decision 2026-10-05):
// Secretary receives, Encoder checks/verifies/posts, Owner does everything.
// The "different person" rules still separate Secretary and Encoder, and the
// Encoder who did the checker count can't verify the same delivery; only the
// Owner is exempt, and every Owner action is still recorded by name.
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { draftReceivingReport } from "../../src/server/application/receiving/draft";
import { submitReceiverCount, submitCheckerCount } from "../../src/server/application/receiving/counting";
import { submitInspection } from "../../src/server/application/receiving/inspection";
import { verifyReceivingReport, VerifierMustNotBeCheckerError } from "../../src/server/application/receiving/verification";
import { approveReceivingReport } from "../../src/server/application/receiving/approval";
import { encodeReceivingReport } from "../../src/server/application/receiving/encoding";
import { requestAdjustment } from "../../src/server/application/adjustment/request";
import { investigateAdjustment } from "../../src/server/application/adjustment/investigate";
import { approveAdjustment } from "../../src/server/application/adjustment/approve";
import { postAdjustment } from "../../src/server/application/adjustment/post";
import { PermissionDeniedError } from "../../src/server/domain/rbac/assertPermission";
import { deriveActiveRoleGrants } from "../../src/server/domain/rbac/activeRoleGrants";
import { getUserByRole, getIloBranch, getSeedVariant, createSessionAndPin, SEED_SUPPLIER_ID } from "./helpers/receiving";

const prisma = new PrismaClient();
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

afterAll(async () => {
  await prisma.$disconnect();
});

/** Secretary drafts + first count + inspects, Encoder second count, Owner verifies (the checker may not) + approves, Encoder posts. */
async function receiveAsThreeRoles(qty: number) {
  const branch = await getIloBranch(prisma);
  const variant = await getSeedVariant(prisma);
  const [secretary, encoder, owner] = await Promise.all(["secretary", "encoder", "owner"].map((u) => getUserByRole(prisma, u)));

  const rr = await draftReceivingReport(prisma, {
    actorUserId: secretary!.id,
    actorRole: "SECRETARY",
    branchId: branch.id,
    supplierId: SEED_SUPPLIER_ID,
    drNumber: `DR-3ROLE-${uniq()}`,
    poReference: `PO-3ROLE-${uniq()}`,
    lines: [{ productVariantId: variant.id, expectedQty: qty, unitCost: 50 }],
  });
  const lines = [{ productVariantId: variant.id, countedQty: qty }];
  await submitReceiverCount(prisma, { rrId: rr.id, actorUserId: secretary!.id, actorRole: "SECRETARY", lines });
  await submitCheckerCount(prisma, { rrId: rr.id, actorUserId: encoder!.id, actorRole: "ENCODER", lines });
  await submitInspection(prisma, { rrId: rr.id, actorUserId: secretary!.id, actorRole: "SECRETARY", outcome: "PASS" });
  await expect(verifyReceivingReport(prisma, { rrId: rr.id, actorUserId: encoder!.id, actorRole: "ENCODER" })).rejects.toThrow(VerifierMustNotBeCheckerError);
  await verifyReceivingReport(prisma, { rrId: rr.id, actorUserId: owner!.id, actorRole: "OWNER" });

  const ownerAuth = await createSessionAndPin(prisma, owner!.id);
  await approveReceivingReport(prisma, { rrId: rr.id, actorUserId: owner!.id, actorRole: "OWNER", session: ownerAuth.session, pinTokenId: ownerAuth.pinToken.id });

  const encoderAuth = await createSessionAndPin(prisma, encoder!.id);
  await encodeReceivingReport(prisma, {
    rrId: rr.id,
    actorUserId: encoder!.id,
    actorRole: "ENCODER",
    branchCode: branch.code,
    session: encoderAuth.session,
    pinTokenId: encoderAuth.pinToken.id,
    evidencePhotos: [{ storageKey: `test:3role-${rr.id}.jpg`, captureMethod: "LIVE_CAMERA_STREAM" }],
  });
  return { rr, branch, variant, secretary: secretary!, encoder: encoder!, owner: owner! };
}

describe("Three-role model", () => {
  it("[grants] Secretary/Encoder inherit their original roles' rows; Owner gets every action at its strongest effect", () => {
    const derived = deriveActiveRoleGrants([
      { role: "WAREHOUSE_RECEIVER", action: "receiving.draft.create", effect: "CREATE" },
      { role: "WAREHOUSE_CHECKER", action: "receiving.count.checker.create", effect: "CREATE" },
      { role: "WAREHOUSE_SUPERVISOR", action: "receiving.verify.create", effect: "APPROVE" },
      { role: "BRANCH_MANAGER", action: "reporting.x.view", effect: "VIEW" },
      { role: "AUDITOR", action: "reporting.x.view", effect: "CREATE" },
      { role: "CASHIER", action: "retail.blocked", effect: "NONE" },
    ]);
    const has = (role: string, action: string) => derived.find((g) => g.role === role && g.action === action);

    expect(has("SECRETARY", "receiving.draft.create")?.effect).toBe("CREATE");
    expect(has("SECRETARY", "receiving.count.checker.create")).toBeUndefined();
    expect(has("ENCODER", "receiving.count.checker.create")?.effect).toBe("CREATE");
    expect(has("ENCODER", "receiving.verify.create")?.effect).toBe("APPROVE");
    expect(has("OWNER", "reporting.x.view")?.effect).toBe("CREATE");
    expect(has("OWNER", "retail.blocked")).toBeUndefined();
  });

  it("[flow] a delivery goes Secretary -> Encoder -> Owner -> Encoder all the way to POSTED; the checker can't verify it", async () => {
    const { rr } = await receiveAsThreeRoles(10);
    const posted = await prisma.receivingReport.findUniqueOrThrow({ where: { id: rr.id } });
    expect(posted.status).toBe("POSTED");
  });

  it("[rule] Secretary and Encoder stay separated: a Secretary cannot do the checker count or approve", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const secretary = await getUserByRole(prisma, "secretary");
    const rr = await draftReceivingReport(prisma, {
      actorUserId: secretary.id,
      actorRole: "SECRETARY",
      branchId: branch.id,
      supplierId: SEED_SUPPLIER_ID,
      drNumber: `DR-3ROLE-SOD-${uniq()}`,
      poReference: `PO-3ROLE-SOD-${uniq()}`,
      lines: [{ productVariantId: variant.id, expectedQty: 5, unitCost: 50 }],
    });
    const lines = [{ productVariantId: variant.id, countedQty: 5 }];
    await submitReceiverCount(prisma, { rrId: rr.id, actorUserId: secretary.id, actorRole: "SECRETARY", lines });

    await expect(submitCheckerCount(prisma, { rrId: rr.id, actorUserId: secretary.id, actorRole: "SECRETARY", lines })).rejects.toThrow(PermissionDeniedError);
    const auth = await createSessionAndPin(prisma, secretary.id);
    await expect(
      approveReceivingReport(prisma, { rrId: rr.id, actorUserId: secretary.id, actorRole: "SECRETARY", session: auth.session, pinTokenId: auth.pinToken.id }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("[owner] the Owner may count both sides of the same delivery (exempt from the different-person rule)", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const owner = await getUserByRole(prisma, "owner");
    const rr = await draftReceivingReport(prisma, {
      actorUserId: owner.id,
      actorRole: "OWNER",
      branchId: branch.id,
      supplierId: SEED_SUPPLIER_ID,
      drNumber: `DR-3ROLE-OWN-${uniq()}`,
      poReference: `PO-3ROLE-OWN-${uniq()}`,
      lines: [{ productVariantId: variant.id, expectedQty: 3, unitCost: 50 }],
    });
    const lines = [{ productVariantId: variant.id, countedQty: 3 }];
    await submitReceiverCount(prisma, { rrId: rr.id, actorUserId: owner.id, actorRole: "OWNER", lines });
    const result = await submitCheckerCount(prisma, { rrId: rr.id, actorUserId: owner.id, actorRole: "OWNER", lines });
    expect(result.matched).toBe(true);
  });

  it("[owner] the Owner can add stock alone: request, investigate, approve, and post their own adjustment", async () => {
    const { branch, variant, owner } = await receiveAsThreeRoles(10);
    const receivingLocation = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "RECEIVING", warehouse: { branchId: branch.id } } });

    const req = await requestAdjustment(prisma, {
      actorUserId: owner.id,
      actorRole: "OWNER",
      branchId: branch.id,
      productVariantId: variant.id,
      warehouseLocationId: receivingLocation.id,
      reasonCode: "ADJ_02",
      quantityDelta: 2,
      reconciliationNotes: "Owner found 2 extra units during a walk-through.",
    });
    await investigateAdjustment(prisma, { actorUserId: owner.id, actorRole: "OWNER", adjustmentRequestId: req.id, outcome: "PROCEED", investigationNotes: "Confirmed by the Owner." });
    const approveAuth = await createSessionAndPin(prisma, owner.id);
    await approveAdjustment(prisma, { actorUserId: owner.id, actorRole: "OWNER", adjustmentRequestId: req.id, outcome: "APPROVE", session: approveAuth.session, pinTokenId: approveAuth.pinToken.id });
    const postAuth = await createSessionAndPin(prisma, owner.id);
    const posted = await postAdjustment(prisma, { actorUserId: owner.id, actorRole: "OWNER", adjustmentRequestId: req.id, branchCode: branch.code, session: postAuth.session, pinTokenId: postAuth.pinToken.id });

    expect(posted.adjustmentRequest.status).toBe("POSTED");
    expect(posted.adjustmentRequest.approvalTier).toBe("OWNER");
    const ledgerRow = await prisma.stockLedger.findFirstOrThrow({ where: { referenceType: "AdjustmentRequest", referenceId: req.id } });
    expect(ledgerRow.performedBy).toBe(owner.id);
    expect(ledgerRow.approvedBy).toBe(owner.id);
    expect(Number(ledgerRow.quantityDeltaBase)).toBe(2);
  });
});
