// One-off follow-up to seed-demo-data.ts: the ILO branch starts with zero
// opening stock by design (only CEB/MNL got opening stock in prisma/seed.ts),
// and seed-demo-data.ts's own in-progress Receiving Reports (PENDING_APPROVAL,
// DRAFT) don't post to the ledger, so 3 of the 4 catalog products were still
// showing zero on-hand after that script ran. This posts one more Receiving
// Report (all 4 lines) so Inventory/Low Stock Alerts have real numbers
// across the whole catalog, then re-tunes reorder points against the final
// balances. Safe to run once after seed-demo-data.ts.
import { prisma } from "../src/lib/prisma";
import { issuePinToken } from "../src/server/domain/session/pinToken";
import { draftReceivingReport } from "../src/server/application/receiving/draft";
import { submitReceiverCount, submitCheckerCount } from "../src/server/application/receiving/counting";
import { submitInspection } from "../src/server/application/receiving/inspection";
import { prepareReceivingReport, verifyReceivingReport } from "../src/server/application/receiving/verification";
import { approveReceivingReport } from "../src/server/application/receiving/approval";
import { encodeReceivingReport } from "../src/server/application/receiving/encoding";
import { setReorderPoint } from "../src/server/application/inventory/reorderPoints";

const SUPPLIER_ID = "seed-supplier-01";
const PIN = "1234";

async function sessionAndPin(userId: string) {
  const session = await prisma.session.create({
    data: { userId, lastActiveAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) },
  });
  const pinToken = await issuePinToken(prisma, { userId, sessionId: session.id, pin: PIN });
  return { session, pinToken };
}

function niceRoundAbove(n: number): number {
  const magnitude = 10 ** Math.max(1, Math.floor(Math.log10(Math.max(n, 1))));
  return Math.ceil((n + 1) / magnitude) * magnitude;
}

async function main() {
  const branch = await prisma.branch.findUniqueOrThrow({ where: { code: "ILO" } });
  const receiver = await prisma.user.findUniqueOrThrow({ where: { username: "warehouse_receiver" } });
  const checker = await prisma.user.findUniqueOrThrow({ where: { username: "warehouse_checker" } });
  const supervisor = await prisma.user.findUniqueOrThrow({ where: { username: "warehouse_supervisor" } });
  const branchManager = await prisma.user.findUniqueOrThrow({ where: { username: "branch_manager" } });
  const encoder = await prisma.user.findUniqueOrThrow({ where: { username: "encoder" } });
  const owner = await prisma.user.findUniqueOrThrow({ where: { username: "owner" } });

  const variants = await prisma.productVariant.findMany({ orderBy: { sku: "asc" } });

  // Only top up variants still sitting at zero on-hand across the branch —
  // safe to re-run without endlessly re-stocking the one that already has some.
  const needsStock = [];
  for (const v of variants) {
    const balances = await prisma.stockBalance.findMany({
      where: { productVariantId: v.id, warehouseLocation: { warehouse: { branchId: branch.id } } },
    });
    const onHand = balances.reduce((sum, b) => sum + Number(b.quantityOnHand), 0);
    if (onHand === 0) needsStock.push(v);
  }

  if (needsStock.length > 0) {
    const lines = needsStock.map((v) => ({ productVariantId: v.id, expectedQty: 60, unitCost: 40 }));
    const rr = await draftReceivingReport(prisma, {
      actorUserId: receiver.id,
      actorRole: "WAREHOUSE_RECEIVER",
      branchId: branch.id,
      supplierId: SUPPLIER_ID,
      drNumber: `DR-DEMO-TOPUP-${Date.now()}`,
      poReference: `PO-DEMO-TOPUP-${Date.now()}`,
      lines,
    });
    const countLines = needsStock.map((v) => ({ productVariantId: v.id, countedQty: 60 }));
    await submitReceiverCount(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", lines: countLines });
    await submitCheckerCount(prisma, { rrId: rr.id, actorUserId: checker.id, actorRole: "WAREHOUSE_CHECKER", lines: countLines });
    await submitInspection(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", outcome: "PASS" });
    await prepareReceivingReport(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER" });
    await verifyReceivingReport(prisma, { rrId: rr.id, actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR" });
    const approverAuth = await sessionAndPin(branchManager.id);
    await approveReceivingReport(prisma, { rrId: rr.id, actorUserId: branchManager.id, actorRole: "BRANCH_MANAGER", session: approverAuth.session, pinTokenId: approverAuth.pinToken.id });
    const encoderAuth = await sessionAndPin(encoder.id);
    await encodeReceivingReport(prisma, {
      rrId: rr.id,
      actorUserId: encoder.id,
      actorRole: "ENCODER",
      branchCode: branch.code,
      session: encoderAuth.session,
      pinTokenId: encoderAuth.pinToken.id,
      evidencePhotos: [{ storageKey: `demo:receiving-${rr.id}.jpg`, captureMethod: "LIVE_CAMERA_STREAM" }],
    });
    console.log(`Receiving Report ${rr.drNumber} -> POSTED (+60 each: ${needsStock.map((v) => v.sku).join(", ")})`);
  } else {
    console.log("Every variant already has on-hand stock — nothing to top up.");
  }

  // Re-tune reorder points against final balances across all 4 variants.
  const withStock = [];
  for (const v of variants) {
    const balances = await prisma.stockBalance.findMany({
      where: { productVariantId: v.id, warehouseLocation: { warehouse: { branchId: branch.id } } },
    });
    const onHand = balances.reduce((sum, b) => sum + Number(b.quantityOnHand), 0);
    withStock.push({ variant: v, onHand });
  }
  const positiveStock = withStock.filter((w) => w.onHand > 0);
  const lowStockTargets = new Set(positiveStock.slice(0, 2).map((w) => w.variant.id));
  const healthyTarget = positiveStock[2]?.variant.id;

  for (const { variant: v, onHand } of withStock) {
    let reorderPoint: number | null;
    if (lowStockTargets.has(v.id)) reorderPoint = niceRoundAbove(onHand);
    else if (v.id === healthyTarget) reorderPoint = Math.max(1, Math.floor(onHand * 0.1));
    else reorderPoint = null;
    if (reorderPoint !== null) {
      await setReorderPoint(prisma, { actorRole: "OWNER", actorUserId: owner.id, productVariantId: v.id, reorderPoint });
    }
    console.log(`${v.sku}: on-hand=${onHand}, reorderPoint=${reorderPoint ?? "(unconfigured)"}`);
  }

  console.log("\nStock top-up + reorder-point tuning done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
