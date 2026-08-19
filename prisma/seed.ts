/**
 * Local dev seed. Extended incrementally as each subsystem is built —
 * do not treat the RolePermission rows here as the final matrix; reconcile
 * against business-process-design.md sec.4.2 before Phase 1 sign-off.
 */
import { PrismaClient, RoleName, PermissionEffect, WarehouseZone } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEV_PASSWORD = "Password123!";
const DEV_PIN = "1234";

async function main() {
  const branch = await prisma.branch.upsert({
    where: { code: "ILO" },
    update: {},
    create: { code: "ILO", name: "Iloilo Main Branch", status: "ACTIVE" },
  });

  // ── Domain masters ─────────────────────────────────────────────────
  const units = await Promise.all(
    [
      { code: "PC", name: "Piece" },
      { code: "KG", name: "Kilogram" },
      { code: "ROLL", name: "Roll" },
      { code: "PACK", name: "Pack" },
      { code: "BOX", name: "Box" },
    ].map((u) => prisma.unitOfMeasure.upsert({ where: { code: u.code }, update: {}, create: u })),
  );
  const unitMap = new Map(units.map((u) => [u.code, u]));
  function unitByCode(code: string) {
    const unit = unitMap.get(code);
    if (!unit) throw new Error(`Seed unit "${code}" was not created`);
    return unit;
  }

  const packagingCategory = await prisma.category.upsert({
    where: { id: "seed-cat-packaging-bags" },
    update: {},
    create: { id: "seed-cat-packaging-bags", name: "Packaging Bags" },
  });
  const rollsCategory = await prisma.category.upsert({
    where: { id: "seed-cat-rolls-film" },
    update: {},
    create: { id: "seed-cat-rolls-film", name: "Rolls & Film" },
  });
  const containersCategory = await prisma.category.upsert({
    where: { id: "seed-cat-containers" },
    update: {},
    create: { id: "seed-cat-containers", name: "Containers" },
  });

  const supplier = await prisma.supplier.upsert({
    where: { id: "seed-supplier-01" },
    update: {},
    create: {
      id: "seed-supplier-01",
      name: "Iloilo Plastics Wholesale Corp.",
      // Number ON FILE, used for G-04 call-back verification — never sourced
      // from delivery paperwork itself.
      contactPhone: "+63 33 555 0101",
      address: "Iloilo City, Iloilo",
    },
  });

  const wholesaleCustomer = await prisma.customer.upsert({
    where: { id: "seed-customer-01" },
    update: {},
    create: {
      id: "seed-customer-01",
      name: "Panay Retail Distribution Inc.",
      contactPhone: "+63 33 555 0202",
    },
  });

  const warehouse = await prisma.warehouse.upsert({
    where: { branchId_code: { branchId: branch.id, code: "WH1" } },
    update: {},
    create: { branchId: branch.id, code: "WH1", name: "Main Warehouse" },
  });

  const zones: WarehouseZone[] = [
    "RECEIVING",
    "STORAGE",
    "PICKING",
    "RELEASE",
    "QUARANTINE",
    "RETURNS",
    "COUNTER",
  ];
  const locations = await Promise.all(
    zones.map((zone) =>
      prisma.warehouseLocation.upsert({
        where: { warehouseId_code: { warehouseId: warehouse.id, code: zone } },
        update: {},
        create: { warehouseId: warehouse.id, zone, code: zone, name: `${zone} area` },
      }),
    ),
  );

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12);
  const pinHash = await bcrypt.hash(DEV_PIN, 12);

  // One test user per role so any role can be logged into locally without
  // manual setup. Username = lowercase role name, e.g. "owner", "encoder".
  const roles = Object.values(RoleName);
  for (const role of roles) {
    const username = role.toLowerCase();
    await prisma.user.upsert({
      where: { username },
      update: {},
      create: {
        username,
        fullName: `Test ${role.replace(/_/g, " ")}`,
        email: `${username}@dev.local`,
        passwordHash,
        pinHash,
        role,
        branchId: branch.id,
        status: "ACTIVE",
      },
    });
  }

  // Starter permission matrix — covers what's built so far (session security,
  // emergency elevation). Extend this block as each workflow's routes land.
  const permissions: Array<{
    role: RoleName;
    action: string;
    effect: PermissionEffect;
  }> = [
    // Every named, active role may mint a transaction PIN token for itself —
    // this is the re-auth-before-posting mechanism (G-30), not a posting
    // action in its own right, so it's granted broadly.
    ...roles.map((role) => ({
      role,
      action: "session.pin-token.issue",
      effect: PermissionEffect.CREATE,
    })),
    // Only the Owner may grant an emergency role-collapse elevation (G-29) —
    // never self-declared.
    {
      role: RoleName.OWNER,
      action: "emergency-elevation.grant",
      effect: PermissionEffect.CREATE,
    },

    // Receiving workflow (BPD sec.7 Steps 1-10 + void, G-05). Mirrors the
    // "Responsible"/"Approval" columns there — not a from-scratch
    // invention. receiving.approve.create is intentionally granted to
    // BRANCH_MANAGER and OWNER only, matching what the seeded
    // ApprovalThreshold rows can actually route to today; if the client's
    // real thresholds ever route to WAREHOUSE_SUPERVISOR too, add it here
    // without any schema change.
    { role: RoleName.SECURITY_GUARD, action: "receiving.gate.log-in", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_RECEIVER, action: "receiving.draft.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_RECEIVER, action: "receiving.callback.confirm", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "receiving.callback.confirm", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_RECEIVER, action: "receiving.count.receiver.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_CHECKER, action: "receiving.count.checker.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "receiving.count.tiebreak.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_RECEIVER, action: "receiving.inspect.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "receiving.inspect.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_RECEIVER, action: "receiving.prepare.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "receiving.verify.create", effect: PermissionEffect.APPROVE },
    { role: RoleName.BRANCH_MANAGER, action: "receiving.approve.create", effect: PermissionEffect.APPROVE },
    { role: RoleName.OWNER, action: "receiving.approve.create", effect: PermissionEffect.APPROVE },
    { role: RoleName.ENCODER, action: "receiving.encode.post", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "receiving.void.create", effect: PermissionEffect.CREATE },
    { role: RoleName.OWNER, action: "receiving.void.create", effect: PermissionEffect.CREATE },

    // Retail sale (Phase 2, BPD sec.8.1). No separate encoding step — the
    // Cashier's own completed-sale action is what posts to the ledger
    // ("automatic on sale completion"), so draft and post are both granted
    // to CASHIER, unlike Receiving's Receiver/Encoder split.
    { role: RoleName.CASHIER, action: "retail.sale.draft.create", effect: PermissionEffect.CREATE },
    { role: RoleName.CASHIER, action: "retail.sale.post.create", effect: PermissionEffect.CREATE },
    { role: RoleName.CASHIER, action: "retail.sale.void.create", effect: PermissionEffect.CREATE },
    { role: RoleName.BRANCH_MANAGER, action: "retail.sale.void.create", effect: PermissionEffect.CREATE },
    // G-12: post-handover void with no goods returned — Branch Manager+ only, never a cashier self-service action.
    { role: RoleName.BRANCH_MANAGER, action: "retail.sale.void-without-return.create", effect: PermissionEffect.CREATE },
    { role: RoleName.OWNER, action: "retail.sale.void-without-return.create", effect: PermissionEffect.CREATE },
    // Intra-branch Storage -> Counter replenishment, closing the untracked-
    // counter-stock gap named in BPD sec.8.1 — a warehouse action, not a
    // Cashier one.
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "inventory.transfer.intra-branch.create", effect: PermissionEffect.CREATE },

    // Adjustments (Phase 2, BPD sec.10 + G-21). Mirrors sec.10.1's table:
    // requester != investigator != approver at every step, never the
    // requester alone at any point.
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "adjustment.request.create", effect: PermissionEffect.CREATE },
    { role: RoleName.ENCODER, action: "adjustment.request.create", effect: PermissionEffect.CREATE },
    { role: RoleName.BRANCH_MANAGER, action: "adjustment.request.create", effect: PermissionEffect.CREATE },
    { role: RoleName.AUDITOR, action: "adjustment.request.create", effect: PermissionEffect.CREATE },
    { role: RoleName.BRANCH_MANAGER, action: "adjustment.investigate.create", effect: PermissionEffect.CREATE },
    { role: RoleName.AUDITOR, action: "adjustment.investigate.create", effect: PermissionEffect.CREATE },
    { role: RoleName.BRANCH_MANAGER, action: "adjustment.approve.create", effect: PermissionEffect.APPROVE },
    { role: RoleName.OWNER, action: "adjustment.approve.create", effect: PermissionEffect.APPROVE },
    { role: RoleName.ENCODER, action: "adjustment.post.create", effect: PermissionEffect.CREATE },
    { role: RoleName.BRANCH_MANAGER, action: "adjustment.void.create", effect: PermissionEffect.CREATE },
    { role: RoleName.OWNER, action: "adjustment.void.create", effect: PermissionEffect.CREATE },

    // Wholesale release (Phase 2, BPD sec.8.2): reservation -> pick -> blind
    // check -> authorize (with G-10's random spot-recount) -> gate check ->
    // post. Each step's role mirrors the person who actually performs that
    // physical action in the warehouse.
    { role: RoleName.SALES_REP, action: "wholesale.order.draft.create", effect: PermissionEffect.CREATE },
    { role: RoleName.SALES_REP, action: "wholesale.order.confirm.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "wholesale.order.reserve.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_PICKER, action: "wholesale.order.pick.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_CHECKER, action: "wholesale.order.check.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "wholesale.spot-recount.create", effect: PermissionEffect.CREATE },
    { role: RoleName.AUDITOR, action: "wholesale.spot-recount.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "wholesale.order.authorize-release.create", effect: PermissionEffect.APPROVE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "wholesale.release.create", effect: PermissionEffect.CREATE },
    { role: RoleName.SECURITY_GUARD, action: "wholesale.gate-check.create", effect: PermissionEffect.CREATE },
    { role: RoleName.ENCODER, action: "wholesale.release.post.create", effect: PermissionEffect.CREATE },
    { role: RoleName.BRANCH_MANAGER, action: "wholesale.order.void.create", effect: PermissionEffect.CREATE },
    { role: RoleName.OWNER, action: "wholesale.order.void.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "wholesale.release.void.create", effect: PermissionEffect.CREATE },
    { role: RoleName.BRANCH_MANAGER, action: "wholesale.release.void.create", effect: PermissionEffect.CREATE },
    { role: RoleName.OWNER, action: "wholesale.release.void.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "wholesale.pod.record.create", effect: PermissionEffect.CREATE },
    { role: RoleName.ENCODER, action: "wholesale.pod.record.create", effect: PermissionEffect.CREATE },

    // Discrepancy case investigation (Phase 3). Same tier that already
    // reviews the cases these auto-open from (G-05 Owner-approval fallback,
    // G-14 evidence mismatch, A-8 recurrence flag) — Branch Manager for
    // day-to-day ownership, Auditor for the cases escalated to them, Owner
    // as the top-of-chain fallback.
    { role: RoleName.BRANCH_MANAGER, action: "discrepancy.assign.create", effect: PermissionEffect.CREATE },
    { role: RoleName.AUDITOR, action: "discrepancy.assign.create", effect: PermissionEffect.CREATE },
    { role: RoleName.OWNER, action: "discrepancy.assign.create", effect: PermissionEffect.CREATE },
    { role: RoleName.BRANCH_MANAGER, action: "discrepancy.close.create", effect: PermissionEffect.CREATE },
    { role: RoleName.AUDITOR, action: "discrepancy.close.create", effect: PermissionEffect.CREATE },
    { role: RoleName.OWNER, action: "discrepancy.close.create", effect: PermissionEffect.CREATE },

    // Customer Returns (Phase 3, BPD sec.9, G-15/G-16/G-17). Issuance has
    // no separate later approval step — the issuer must already meet the
    // resolveRequiredApprover tier, so both Branch Manager and Owner are
    // granted create here and the threshold engine decides which one is
    // actually required for a given return's value/risk tier.
    { role: RoleName.BRANCH_MANAGER, action: "returns.authorize.create", effect: PermissionEffect.CREATE },
    { role: RoleName.OWNER, action: "returns.authorize.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_RECEIVER, action: "returns.receive.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_RECEIVER, action: "returns.count.receive.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_CHECKER, action: "returns.count.check.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "returns.grade.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_CHECKER, action: "returns.grade.create", effect: PermissionEffect.CREATE },
    { role: RoleName.BRANCH_MANAGER, action: "returns.grade.resolve-dispute.create", effect: PermissionEffect.CREATE },
    { role: RoleName.OWNER, action: "returns.grade.resolve-dispute.create", effect: PermissionEffect.CREATE },
    { role: RoleName.ENCODER, action: "returns.post.create", effect: PermissionEffect.CREATE },
    { role: RoleName.BRANCH_MANAGER, action: "returns.void.create", effect: PermissionEffect.CREATE },
    { role: RoleName.OWNER, action: "returns.void.create", effect: PermissionEffect.CREATE },

    // Damage & Disposal (Phase 3, BPD sec.8.4, G-18/G-19/G-20).
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "disposal.report.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_RECEIVER, action: "disposal.report.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "disposal.report.investigate.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "disposal.certificate.create", effect: PermissionEffect.CREATE },
    { role: RoleName.BRANCH_MANAGER, action: "disposal.certificate.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "disposal.certificate.destroy.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "disposal.certificate.scrap-sale.create", effect: PermissionEffect.CREATE },
    { role: RoleName.OWNER, action: "disposal.certificate.scrap-sale.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "disposal.certificate.sell-as-seconds.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "disposal.certificate.return-to-supplier.create", effect: PermissionEffect.CREATE },
    { role: RoleName.BRANCH_MANAGER, action: "disposal.certificate.void.create", effect: PermissionEffect.CREATE },
    { role: RoleName.OWNER, action: "disposal.certificate.void.create", effect: PermissionEffect.CREATE },
    { role: RoleName.AUDITOR, action: "disposal.aging-check.create", effect: PermissionEffect.CREATE },
    { role: RoleName.BRANCH_MANAGER, action: "disposal.aging-check.create", effect: PermissionEffect.CREATE },
  ];

  for (const p of permissions) {
    await prisma.rolePermission.upsert({
      where: { role_action: { role: p.role, action: p.action } },
      update: { effect: p.effect },
      create: p,
    });
  }

  // Sample products/variants, each with an ACTIVE, witnessed-verified
  // conversion rate, so the Receiving workflow (and a client demo) has a
  // realistic small catalog to post against. Verification "witnesses" are
  // both the seeded owner account here — a real second-person verification
  // is enforced by the app layer, not by this seed.
  const owner = await prisma.user.findUniqueOrThrow({ where: { username: "owner" } });

  const demoProducts: Array<{
    id: string;
    name: string;
    categoryId: string;
    cycleCountClass: "A" | "B" | "C";
    sku: string;
    sellingPrice: number;
    fromUnit: string;
    rate: number; // 1 fromUnit = `rate` base PC
  }> = [
    {
      id: "seed-product-pe-bag-10x12",
      name: 'PE Bag 10x12"',
      categoryId: packagingCategory.id,
      cycleCountClass: "A",
      sku: "PEBAG-10X12-PACK100",
      sellingPrice: 250.0,
      fromUnit: "PACK",
      rate: 100, // 1 PACK = 100 PC
    },
    {
      id: "seed-product-trash-bag-xl",
      name: 'Trash Bag XL 25x35"',
      categoryId: packagingCategory.id,
      cycleCountClass: "A",
      sku: "TRASHBAG-XL-PACK50",
      sellingPrice: 180.0,
      fromUnit: "PACK",
      rate: 50, // 1 PACK = 50 PC
    },
    {
      id: "seed-product-shrink-film-500",
      name: "Shrink Film 500mm x 500m",
      categoryId: rollsCategory.id,
      cycleCountClass: "B",
      sku: "SHRINKFILM-500-BOX10",
      sellingPrice: 950.0,
      fromUnit: "BOX",
      rate: 10, // 1 BOX = 10 rolls (PC)
    },
    {
      id: "seed-product-container-1l",
      name: "Plastic Container 1L w/ Lid",
      categoryId: containersCategory.id,
      cycleCountClass: "B",
      sku: "CONTAINER-1L-BOX24",
      sellingPrice: 420.0,
      fromUnit: "BOX",
      rate: 24, // 1 BOX = 24 PC
    },
  ];

  for (const dp of demoProducts) {
    const product = await prisma.product.upsert({
      where: { id: dp.id },
      update: {},
      create: {
        id: dp.id,
        name: dp.name,
        categoryId: dp.categoryId,
        baseUnitId: unitByCode("PC").id,
        cycleCountClass: dp.cycleCountClass,
      },
    });
    const variant = await prisma.productVariant.upsert({
      where: { sku: dp.sku },
      update: {},
      create: {
        productId: product.id,
        sku: dp.sku,
        sellingPrice: dp.sellingPrice,
      },
    });
    await prisma.conversionRateVersion.upsert({
      where: { id: `seed-conv-${dp.id}` },
      update: {},
      create: {
        id: `seed-conv-${dp.id}`,
        productVariantId: variant.id,
        fromUnitId: unitByCode(dp.fromUnit).id,
        toUnitId: unitByCode("PC").id,
        rate: dp.rate,
        status: "ACTIVE",
        proposedBy: owner.id,
        verifiedByUser1: owner.id,
        verifiedByUser2: owner.id,
        effectiveFrom: new Date(),
      },
    });
  }

  // Opening booklet ranges for controlled document types at the seeded
  // branch, so document numbering has something registered to validate
  // against.
  const booklets: Array<{ id: string; documentType: string }> = [
    { id: "seed-booklet-rr-ilo-2026", documentType: "RR" },
    { id: "seed-booklet-si-ilo-2026", documentType: "SI" }, // Retail Sales Invoice/OR (Phase 2)
    { id: "seed-booklet-adj-ilo-2026", documentType: "ADJ" }, // Adjustments (Phase 2)
    { id: "seed-booklet-dr-ilo-2026", documentType: "DR" }, // Wholesale Delivery Receipt (Phase 2)
    { id: "seed-booklet-ra-ilo-2026", documentType: "RA" }, // Customer Return Authorization (Phase 3)
    { id: "seed-booklet-dc-ilo-2026", documentType: "DC" }, // Disposal Certificate (Phase 3)
  ];
  for (const b of booklets) {
    await prisma.documentBookletRegistry.upsert({
      where: { id: b.id },
      update: {},
      create: {
        id: b.id,
        branchId: branch.id,
        documentType: b.documentType,
        rangeStart: 1,
        rangeEnd: 999,
        registeredBy: owner.id,
      },
    });
  }

  // Placeholder approval thresholds (client-decisions-needed.md #2's
  // recommended default — the client has not confirmed real peso values
  // yet). Global defaults (branchId null) so every branch inherits them
  // until a branch-specific override is registered. Receiving Report
  // approval (Step 9, business-process-design.md "Per Appendix B") is the
  // first consumer in Phase 1; Phase 2's adjustment/write-off workflows
  // reuse the same table without any schema change.
  const approvalThresholds: Array<{
    id: string;
    transactionType: string;
    minValue: number;
    maxValue: number | null;
    requiredApproverRole: RoleName;
  }> = [
    {
      id: "seed-threshold-receiving-tier1",
      transactionType: "RECEIVING",
      minValue: 0,
      maxValue: 10000,
      requiredApproverRole: RoleName.BRANCH_MANAGER,
    },
    {
      id: "seed-threshold-receiving-tier2",
      transactionType: "RECEIVING",
      minValue: 10000.01,
      maxValue: null,
      requiredApproverRole: RoleName.OWNER,
    },
    // Same recommended-default numbers as RECEIVING (client-decisions-
    // needed.md #2) — a distinct transactionType row is required since
    // resolveRequiredApprover matches on it exactly, but the peso values
    // are the same placeholder pending client confirmation.
    {
      id: "seed-threshold-adjustment-tier1",
      transactionType: "ADJUSTMENT",
      minValue: 0,
      maxValue: 10000,
      requiredApproverRole: RoleName.BRANCH_MANAGER,
    },
    {
      id: "seed-threshold-adjustment-tier2",
      transactionType: "ADJUSTMENT",
      minValue: 10000.01,
      maxValue: null,
      requiredApproverRole: RoleName.OWNER,
    },
    // Same recommended-default methodology (client-decisions-needed.md #2)
    // — RETURN_NO_DOCUMENT is deliberately a stricter (lower) cutover to
    // Owner than ordinary RETURN, since identityVerification == NONE is
    // the higher-fraud-risk path (BPD/G-15).
    {
      id: "seed-threshold-return-tier1",
      transactionType: "RETURN",
      minValue: 0,
      maxValue: 10000,
      requiredApproverRole: RoleName.BRANCH_MANAGER,
    },
    {
      id: "seed-threshold-return-tier2",
      transactionType: "RETURN",
      minValue: 10000.01,
      maxValue: null,
      requiredApproverRole: RoleName.OWNER,
    },
    {
      id: "seed-threshold-return-no-document-tier1",
      transactionType: "RETURN_NO_DOCUMENT",
      minValue: 0,
      maxValue: 2000,
      requiredApproverRole: RoleName.BRANCH_MANAGER,
    },
    {
      id: "seed-threshold-return-no-document-tier2",
      transactionType: "RETURN_NO_DOCUMENT",
      minValue: 2000.01,
      maxValue: null,
      requiredApproverRole: RoleName.OWNER,
    },
    // RETURN_GRADING isn't a role-of-approval lookup like the others — it's
    // reused as a boolean signal (see grade.ts's SINGLE_GRADING_SUFFICIENT_
    // TIER): resolving to WAREHOUSE_SUPERVISOR means a single grading
    // suffices, resolving to anything above it means double-blind grading
    // is mandatory.
    {
      id: "seed-threshold-return-grading-tier1",
      transactionType: "RETURN_GRADING",
      minValue: 0,
      maxValue: 5000,
      requiredApproverRole: RoleName.WAREHOUSE_SUPERVISOR,
    },
    {
      id: "seed-threshold-return-grading-tier2",
      transactionType: "RETURN_GRADING",
      minValue: 5000.01,
      maxValue: null,
      requiredApproverRole: RoleName.BRANCH_MANAGER,
    },
    // SCRAP_SALE_BELOW_BENCHMARK — same reuse pattern: any resolved role
    // other than a no-op tier means Owner sign-off is required. A single
    // tier starting at 0 means every below-benchmark scrap sale needs it.
    {
      id: "seed-threshold-scrap-sale-below-benchmark",
      transactionType: "SCRAP_SALE_BELOW_BENCHMARK",
      minValue: 0,
      maxValue: null,
      requiredApproverRole: RoleName.OWNER,
    },
  ];
  for (const t of approvalThresholds) {
    await prisma.approvalThreshold.upsert({
      where: { id: t.id },
      update: {},
      create: {
        id: t.id,
        branchId: null,
        transactionType: t.transactionType,
        minValue: t.minValue,
        maxValue: t.maxValue,
        requiredApproverRole: t.requiredApproverRole,
        isPlaceholder: true,
      },
    });
  }

  console.log(
    `Seeded branch "${branch.code}", ${units.length} units, ${locations.length} warehouse locations, supplier "${supplier.name}", wholesale customer "${wholesaleCustomer.name}", ${roles.length} test users, ${permissions.length} permission rows, ${demoProducts.length} sample product variants with ACTIVE conversion rates, ${booklets.length} document booklets, ${approvalThresholds.length} approval threshold placeholders.`,
  );
  console.log(`Dev login: username = any role name lowercase (e.g. "owner"), password = "${DEV_PASSWORD}"`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
