// G-14 — POD (proof-of-delivery) return tracking must have its own
// internal SLA clock, independent of whether/when the customer confirms
// receipt — a customer who never confirms should not indefinitely delay
// visibility into an unreturned POD.
// SYSTEM RULE: recordPodReturn and recordCustomerConfirmation write to two
// genuinely separate timestamp fields (podReturnedAt vs
// customerConfirmedAt).
// DETECTION: checkOverduePodReturns (24h internal SLA) opens a
// DiscrepancyCase for any POSTED release with no podReturnedAt yet,
// regardless of customerConfirmedAt — this mechanism is its own detection,
// no separate gap test needed.
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSalesOrderRelease } from "../../src/server/application/wholesale/release";
import { recordGateCheck } from "../../src/server/application/wholesale/gateCheck";
import { postSalesOrderRelease } from "../../src/server/application/wholesale/post";
import { recordPodReturn, recordCustomerConfirmation, checkOverduePodReturns } from "../../src/server/application/wholesale/pod";
import { getIloBranch, getSeedVariant, getUserByRole, createSessionAndPin } from "./helpers/receiving";
import { draftToPendingReleaseApproval } from "./helpers/wholesale";

const prisma = new PrismaClient();

async function ensureUnitWeight(variantId: string, kg: number) {
  const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
  await prisma.product.update({ where: { id: variant.productId }, data: { unitWeightKg: kg } });
}

async function createPostedRelease(branchId: string, branchCode: string, variantId: string, qty: number) {
  await ensureUnitWeight(variantId, 5);
  const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
  const guard = await getUserByRole(prisma, "security_guard");
  const encoder = await getUserByRole(prisma, "encoder");
  const { order, lineId } = await draftToPendingReleaseApproval(prisma, { branchId, variantId, qty });

  const { session: s1, pinToken: p1 } = await createSessionAndPin(prisma, supervisor.id);
  const release = await createSalesOrderRelease(prisma, {
    actorUserId: supervisor.id,
    actorRole: "WAREHOUSE_SUPERVISOR",
    salesOrderId: order.id,
    lines: [{ salesOrderLineId: lineId, qty }],
    session: s1,
    pinTokenId: p1.id,
  });

  await recordGateCheck(prisma, {
    actorUserId: guard.id,
    actorRole: "SECURITY_GUARD",
    releaseId: release.id,
    sealNumber: `SEAL-G14-${Date.now()}`,
    sealVerifiedIntact: true,
    actualWeightKg: qty * 5,
  });

  const { session: s2, pinToken: p2 } = await createSessionAndPin(prisma, encoder.id);
  const posted = await postSalesOrderRelease(prisma, {
    actorUserId: encoder.id,
    actorRole: "ENCODER",
    releaseId: release.id,
    branchCode,
    session: s2,
    pinTokenId: p2.id,
  });
  return posted.release;
}

describe("G-14: POD return tracking — independent internal SLA clock", () => {
  it("[rule] podReturnedAt and customerConfirmedAt are genuinely independent fields — one can be set without the other", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const encoder = await getUserByRole(prisma, "encoder");
    const release = await createPostedRelease(branch.id, branch.code, variant.id, 3);

    const afterPod = await recordPodReturn(prisma, { actorUserId: encoder.id, actorRole: "ENCODER", releaseId: release.id });
    expect(afterPod.podReturnedAt).not.toBeNull();
    expect(afterPod.customerConfirmedAt).toBeNull();

    const afterConfirm = await recordCustomerConfirmation(prisma, { actorUserId: encoder.id, actorRole: "ENCODER", releaseId: release.id });
    expect(afterConfirm.customerConfirmedAt).not.toBeNull();
  });

  it("[rule] checkOverduePodReturns opens a DiscrepancyCase for a POSTED release past the 24h internal SLA with no podReturnedAt — regardless of customer confirmation", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const encoder = await getUserByRole(prisma, "encoder");
    const owner = await getUserByRole(prisma, "owner");
    const release = await createPostedRelease(branch.id, branch.code, variant.id, 2);

    // Customer confirms receipt immediately — but the internal POD
    // paperwork clock is independent and must still fire on its own.
    await recordCustomerConfirmation(prisma, { actorUserId: encoder.id, actorRole: "ENCODER", releaseId: release.id });
    await prisma.salesOrderRelease.update({ where: { id: release.id }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });

    const opened = await checkOverduePodReturns(prisma, { actorUserId: owner.id });
    const thisOne = opened.find((c) => c.referenceType === "SalesOrderRelease" && c.referenceId === release.id);
    expect(thisOne).toBeDefined();

    const caseRow = await prisma.discrepancyCase.findFirst({ where: { referenceType: "SalesOrderRelease", referenceId: release.id } });
    expect(caseRow).not.toBeNull();
  });

  it("[rule] a release with podReturnedAt already set is never flagged, even past the SLA window", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const encoder = await getUserByRole(prisma, "encoder");
    const owner = await getUserByRole(prisma, "owner");
    const release = await createPostedRelease(branch.id, branch.code, variant.id, 1);

    await recordPodReturn(prisma, { actorUserId: encoder.id, actorRole: "ENCODER", releaseId: release.id });
    await prisma.salesOrderRelease.update({ where: { id: release.id }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });

    const opened = await checkOverduePodReturns(prisma, { actorUserId: owner.id });
    const thisOne = opened.find((c) => c.referenceType === "SalesOrderRelease" && c.referenceId === release.id);
    expect(thisOne).toBeUndefined();
  });
});
