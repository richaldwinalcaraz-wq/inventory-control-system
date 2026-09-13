// One-off: populates realistic demo data for a client walkthrough, using
// the real application-layer workflow functions (not raw Prisma writes) so
// RBAC, the stock ledger, and document numbering all behave exactly as
// they would from the UI. Additive only, not idempotent — re-running adds
// more records rather than resetting anything. Intended for the 7
// currently-visible features (see middleware.ts): Receiving, Damage &
// Disposal, Inventory, Low Stock Alerts, Reorder Points, Daily Exception
// Report, Shrinkage Rate.
import { prisma } from "../src/lib/prisma";
import { issuePinToken } from "../src/server/domain/session/pinToken";
import { draftReceivingReport } from "../src/server/application/receiving/draft";
import { submitReceiverCount, submitCheckerCount } from "../src/server/application/receiving/counting";
import { submitInspection } from "../src/server/application/receiving/inspection";
import { prepareReceivingReport, verifyReceivingReport } from "../src/server/application/receiving/verification";
import { approveReceivingReport } from "../src/server/application/receiving/approval";
import { encodeReceivingReport } from "../src/server/application/receiving/encoding";
import { createDamageReport } from "../src/server/application/disposal/report";
import { createDisposalCertificate } from "../src/server/application/disposal/createCertificate";
import { recordDestructionEvidence, postDestroyCertificate } from "../src/server/application/disposal/destroy";
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

async function main() {
  const branch = await prisma.branch.findUniqueOrThrow({ where: { code: "ILO" } });
  const receiver = await prisma.user.findUniqueOrThrow({ where: { username: "warehouse_receiver" } });
  const checker = await prisma.user.findUniqueOrThrow({ where: { username: "warehouse_checker" } });
  const supervisor = await prisma.user.findUniqueOrThrow({ where: { username: "warehouse_supervisor" } });
  const branchManager = await prisma.user.findUniqueOrThrow({ where: { username: "branch_manager" } });
  const encoder = await prisma.user.findUniqueOrThrow({ where: { username: "encoder" } });
  const auditor = await prisma.user.findUniqueOrThrow({ where: { username: "auditor" } });
  const owner = await prisma.user.findUniqueOrThrow({ where: { username: "owner" } });

  const variants = await prisma.productVariant.findMany({ orderBy: { sku: "asc" } });
  if (variants.length < 4) {
    throw new Error(`Expected at least 4 seeded product variants, found ${variants.length}.`);
  }
  const [vBag, vTrash, vShrink, vContainer] = variants as [
    (typeof variants)[number],
    (typeof variants)[number],
    (typeof variants)[number],
    (typeof variants)[number],
  ];
  console.log(`Branch ${branch.code}; variants: ${variants.map((v) => v.sku).join(", ")}`);

  // ---- 1. Receiving Report, full flow -> POSTED (adds real stock) ----
  {
    const qty = 40;
    const unitCost = 45;
    const rr = await draftReceivingReport(prisma, {
      actorUserId: receiver.id,
      actorRole: "WAREHOUSE_RECEIVER",
      branchId: branch.id,
      supplierId: SUPPLIER_ID,
      drNumber: `DR-DEMO-${Date.now()}-1`,
      poReference: `PO-DEMO-${Date.now()}-1`,
      lines: [{ productVariantId: vBag.id, expectedQty: qty, unitCost }],
    });
    await submitReceiverCount(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", lines: [{ productVariantId: vBag.id, countedQty: qty }] });
    await submitCheckerCount(prisma, { rrId: rr.id, actorUserId: checker.id, actorRole: "WAREHOUSE_CHECKER", lines: [{ productVariantId: vBag.id, countedQty: qty }] });
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
    console.log(`Receiving Report ${rr.drNumber} -> POSTED (+${qty} ${vBag.sku})`);
  }

  // ---- 2. Receiving Report, stopped at PENDING_APPROVAL (in-progress) ----
  {
    const qty = 25;
    const unitCost = 90;
    const rr = await draftReceivingReport(prisma, {
      actorUserId: receiver.id,
      actorRole: "WAREHOUSE_RECEIVER",
      branchId: branch.id,
      supplierId: SUPPLIER_ID,
      drNumber: `DR-DEMO-${Date.now()}-2`,
      poReference: `PO-DEMO-${Date.now()}-2`,
      lines: [{ productVariantId: vTrash.id, expectedQty: qty, unitCost }],
    });
    await submitReceiverCount(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", lines: [{ productVariantId: vTrash.id, countedQty: qty }] });
    await submitCheckerCount(prisma, { rrId: rr.id, actorUserId: checker.id, actorRole: "WAREHOUSE_CHECKER", lines: [{ productVariantId: vTrash.id, countedQty: qty }] });
    await submitInspection(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", outcome: "PASS" });
    await prepareReceivingReport(prisma, { rrId: rr.id, actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER" });
    await verifyReceivingReport(prisma, { rrId: rr.id, actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR" });
    console.log(`Receiving Report ${rr.drNumber} -> PENDING_APPROVAL (awaiting Branch Manager)`);
  }

  // ---- 3. Receiving Report, fresh DRAFT (earliest stage) ----
  {
    const qty = 15;
    const unitCost = 120;
    const rr = await draftReceivingReport(prisma, {
      actorUserId: receiver.id,
      actorRole: "WAREHOUSE_RECEIVER",
      branchId: branch.id,
      supplierId: SUPPLIER_ID,
      drNumber: `DR-DEMO-${Date.now()}-3`,
      poReference: `PO-DEMO-${Date.now()}-3`,
      lines: [{ productVariantId: vShrink.id, expectedQty: qty, unitCost }],
    });
    console.log(`Receiving Report ${rr.drNumber} -> DRAFT (just created)`);
  }

  // Damage reports need a location where the variant has an actual cost
  // basis (a prior inbound movement) — assuming a zone name (e.g.
  // "STORAGE") isn't safe, production's actual stock distribution across
  // zones/locations doesn't match what local dev/test data happens to have.
  async function findLocationWithStock(productVariantId: string, minQty: number) {
    const balance = await prisma.stockBalance.findFirst({
      where: { productVariantId, quantityOnHand: { gte: minQty }, warehouseLocation: { warehouse: { branchId: branch.id } } },
    });
    if (!balance) throw new Error(`No location in ${branch.code} has >= ${minQty} on-hand for product variant ${productVariantId}.`);
    return balance.warehouseLocationId;
  }

  // ---- 4. Damage & Disposal, full destroy flow -> POSTED ----
  // Uses vBag, which step 1 just received (guaranteed real stock+cost basis).
  {
    const qty = 3;
    const locationId = await findLocationWithStock(vBag.id, qty);
    const dr = await createDamageReport(prisma, {
      actorUserId: supervisor.id,
      actorRole: "WAREHOUSE_SUPERVISOR",
      branchId: branch.id,
      productVariantId: vBag.id,
      warehouseLocationId: locationId,
      sourceType: "STORAGE",
      quantity: qty,
      cause: "Cracked lids found during routine storage check — stack was over-palleted, crushing the bottom layer.",
    });
    const dc = await createDisposalCertificate(prisma, {
      actorUserId: supervisor.id,
      actorRole: "WAREHOUSE_SUPERVISOR",
      damageReportId: dr.id,
      disposition: "DESTROY",
      quantity: qty,
      witness1Id: receiver.id,
      witness2Id: auditor.id,
    });
    await recordDestructionEvidence(prisma, {
      actorUserId: supervisor.id,
      actorRole: "WAREHOUSE_SUPERVISOR",
      dcId: dc.id,
      evidencePhotos: [{ storageKey: `demo:destroy-${dc.id}.jpg`, captureMethod: "LIVE_CAMERA_STREAM" }],
    });
    const destroyAuth = await sessionAndPin(supervisor.id);
    await postDestroyCertificate(prisma, {
      actorUserId: supervisor.id,
      actorRole: "WAREHOUSE_SUPERVISOR",
      branchCode: branch.code,
      dcId: dc.id,
      session: destroyAuth.session,
      pinTokenId: destroyAuth.pinToken.id,
    });
    console.log(`Damage Report + Disposal Certificate for ${vBag.sku} -> POSTED (destroyed ${qty})`);
  }

  // ---- 5. Damage Report, left open (in-progress case) ----
  // Tries each other variant in turn until one has enough stock somewhere
  // in the branch — production's actual per-variant stock varies, so don't
  // assume any single SKU has it.
  {
    const candidates = [vTrash, vShrink, vContainer, vBag];
    let openTarget: (typeof candidates)[number] | null = null;
    let openLocationId: string | null = null;
    for (const candidate of candidates) {
      try {
        openLocationId = await findLocationWithStock(candidate.id, 5);
        openTarget = candidate;
        break;
      } catch {
        continue;
      }
    }
    if (!openTarget || !openLocationId) {
      throw new Error("No variant in this branch has >= 5 on-hand anywhere — can't create the open Damage Report demo case.");
    }
    const dr = await createDamageReport(prisma, {
      actorUserId: receiver.id,
      actorRole: "WAREHOUSE_RECEIVER",
      branchId: branch.id,
      productVariantId: openTarget.id,
      warehouseLocationId: openLocationId,
      sourceType: "HANDLING",
      quantity: 5,
      cause: "Forklift snag tore several bags while moving pallets to the picking zone.",
    });
    console.log(`Damage Report for ${openTarget.sku} -> REPORTED (open, not yet disposed)`);
  }

  // ---- 6. Reorder points, tuned against final on-hand stock ----
  // Up to 2 variants with real stock get pushed into LOW_STOCK, one healthy
  // (configured but not alerting), the rest left unconfigured (demonstrates
  // "not every product needs monitoring"). A variant already at 0 on-hand
  // is left alone rather than force-alerted — it'd show OUT_OF_STOCK either
  // way once someone does configure it, no need to fabricate that here.
  function niceRoundAbove(n: number): number {
    // Rounds up to a "someone actually typed this" number instead of a
    // giveaway exact offset (e.g. 849225 -> 850000, 40 -> 50, 12 -> 20).
    const magnitude = 10 ** Math.max(1, Math.floor(Math.log10(Math.max(n, 1))));
    return Math.ceil((n + 1) / magnitude) * magnitude;
  }

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

  console.log("\nDemo data seeded.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
