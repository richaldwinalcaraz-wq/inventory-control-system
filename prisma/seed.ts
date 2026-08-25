/**
 * Local dev seed. Extended incrementally as each subsystem is built —
 * do not treat the RolePermission rows here as the final matrix; reconcile
 * against business-process-design.md sec.4.2 before Phase 1 sign-off.
 */
import { randomUUID, createHash } from "node:crypto";
import { PrismaClient, RoleName, PermissionEffect, WarehouseZone } from "@prisma/client";
import bcrypt from "bcryptjs";
import { postLedgerEntry } from "../src/server/domain/ledger/postLedgerEntry";

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

    // Cycle Counts (Phase 4, BPD sec.12.1, G-08). Declaring/closing the
    // branch-wide freeze window is a Supervisor-or-above action — the same
    // tier BPD already trusts with the physical count itself.
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "cycle-count.window.declare.create", effect: PermissionEffect.CREATE },
    { role: RoleName.BRANCH_MANAGER, action: "cycle-count.window.declare.create", effect: PermissionEffect.CREATE },
    { role: RoleName.OWNER, action: "cycle-count.window.declare.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "cycle-count.window.close.create", effect: PermissionEffect.CREATE },
    { role: RoleName.BRANCH_MANAGER, action: "cycle-count.window.close.create", effect: PermissionEffect.CREATE },
    { role: RoleName.OWNER, action: "cycle-count.window.close.create", effect: PermissionEffect.CREATE },
    { role: RoleName.AUDITOR, action: "cycle-count.window.violation-check.create", effect: PermissionEffect.CREATE },
    { role: RoleName.BRANCH_MANAGER, action: "cycle-count.window.violation-check.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "cycle-count.window.exception.create", effect: PermissionEffect.CREATE },
    { role: RoleName.BRANCH_MANAGER, action: "cycle-count.window.exception.create", effect: PermissionEffect.CREATE },
    { role: RoleName.OWNER, action: "cycle-count.window.exception.create", effect: PermissionEffect.CREATE },
    { role: RoleName.AUDITOR, action: "cycle-count.schedule.generate.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "cycle-count.schedule.generate.create", effect: PermissionEffect.CREATE },
    { role: RoleName.AUDITOR, action: "cycle-count.compliance.check.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "cycle-count.compliance.check.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "cycle-count.record.start.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_RECEIVER, action: "cycle-count.record.start.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_RECEIVER, action: "cycle-count.count.primary.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_CHECKER, action: "cycle-count.count.primary.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_PICKER, action: "cycle-count.count.primary.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_RECEIVER, action: "cycle-count.count.secondary.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_CHECKER, action: "cycle-count.count.secondary.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_PICKER, action: "cycle-count.count.secondary.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "cycle-count.count.tiebreak.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "cycle-count.evaluate.create", effect: PermissionEffect.CREATE },
    { role: RoleName.AUDITOR, action: "cycle-count.evaluate.create", effect: PermissionEffect.CREATE },
    // Recount pool is deliberately as broad as primary/secondary counting —
    // BPD 12.1's "immediate recount by a different person" means whoever's
    // genuinely available and uninvolved, not just a Supervisor. SoD (not
    // one of the 3 prior counters) is enforced in code, not by narrowing
    // the role grant.
    { role: RoleName.WAREHOUSE_RECEIVER, action: "cycle-count.recount.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_CHECKER, action: "cycle-count.recount.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_PICKER, action: "cycle-count.recount.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "cycle-count.recount.create", effect: PermissionEffect.CREATE },
    { role: RoleName.AUDITOR, action: "cycle-count.recount.create", effect: PermissionEffect.CREATE },

    // Daily Reconciliation (Phase 4, BPD sec.14.3-14.4, G-26).
    { role: RoleName.ENCODER, action: "reconciliation.prepare.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_RECEIVER, action: "reconciliation.bin-card.capture.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_CHECKER, action: "reconciliation.bin-card.capture.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "reconciliation.bin-card.capture.create", effect: PermissionEffect.CREATE },
    // Review pool is deliberately broad, not Supervisor-only — G-26's own
    // rationale is "find someone available who wasn't involved," and BPD
    // explicitly allows small-branch reality to force an ineligible
    // reviewer rather than have no reviewer at all. Eligibility (not RBAC)
    // is what enforces SoD here, same reasoning as cycle-count recount.
    { role: RoleName.ENCODER, action: "reconciliation.review.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_RECEIVER, action: "reconciliation.review.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_CHECKER, action: "reconciliation.review.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "reconciliation.review.create", effect: PermissionEffect.CREATE },
    { role: RoleName.BRANCH_MANAGER, action: "reconciliation.review.create", effect: PermissionEffect.CREATE },
    { role: RoleName.AUDITOR, action: "reconciliation.review.create", effect: PermissionEffect.CREATE },
    { role: RoleName.BRANCH_MANAGER, action: "reconciliation.sign-off.create", effect: PermissionEffect.CREATE },
    { role: RoleName.OWNER, action: "reconciliation.sign-off.create", effect: PermissionEffect.CREATE },

    // Multi-Branch / Inter-Branch Transfer (Phase 4, MB-1..8, G-35). The
    // request itself IS the receiving-branch approval (MB-4) — Branch
    // Manager+ only, no separate second gate.
    { role: RoleName.BRANCH_MANAGER, action: "multibranch.transfer.request.create", effect: PermissionEffect.CREATE },
    { role: RoleName.OWNER, action: "multibranch.transfer.request.create", effect: PermissionEffect.CREATE },
    { role: RoleName.BRANCH_MANAGER, action: "multibranch.transfer.approve-sending.create", effect: PermissionEffect.CREATE },
    { role: RoleName.OWNER, action: "multibranch.transfer.approve-sending.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_PICKER, action: "multibranch.transfer.pick.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_CHECKER, action: "multibranch.transfer.check.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_SUPERVISOR, action: "multibranch.transfer.dispatch.create", effect: PermissionEffect.CREATE },
    { role: RoleName.ENCODER, action: "multibranch.transfer.dispatch.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_RECEIVER, action: "multibranch.transfer.receive.create", effect: PermissionEffect.CREATE },
    { role: RoleName.WAREHOUSE_CHECKER, action: "multibranch.transfer.receive-check.create", effect: PermissionEffect.CREATE },
    { role: RoleName.AUDITOR, action: "multibranch.transfer.confirm-evidence.create", effect: PermissionEffect.CREATE },
    { role: RoleName.ENCODER, action: "multibranch.transfer.close.create", effect: PermissionEffect.CREATE },
    { role: RoleName.AUDITOR, action: "multibranch.transfer.overdue-check.create", effect: PermissionEffect.CREATE },
    { role: RoleName.BRANCH_MANAGER, action: "multibranch.transfer.overdue-check.create", effect: PermissionEffect.CREATE },

    // Account deactivation cascade (Phase 4, G-31).
    { role: RoleName.AUDITOR, action: "discrepancy.deactivated-users-check.create", effect: PermissionEffect.CREATE },
    { role: RoleName.OWNER, action: "discrepancy.deactivated-users-check.create", effect: PermissionEffect.CREATE },

    // Cross-branch stock visibility, read-only (Phase 4, MB-7).
    { role: RoleName.BRANCH_MANAGER, action: "multibranch.stock.view-other-branch", effect: PermissionEffect.VIEW },
    { role: RoleName.OWNER, action: "multibranch.stock.view-other-branch", effect: PermissionEffect.VIEW },
    { role: RoleName.AUDITOR, action: "multibranch.stock.view-other-branch", effect: PermissionEffect.VIEW },

    // Daily Exception Report (Phase 4, G-28) — deliberately never granted to
    // BRANCH_MANAGER: BPD requires this be un-suppressible by any branch role.
    { role: RoleName.OWNER, action: "reporting.daily-exception.view", effect: PermissionEffect.VIEW },
    { role: RoleName.AUDITOR, action: "reporting.daily-exception.view", effect: PermissionEffect.VIEW },

    // Reporting suite (Phase 4 step 17) — same viewer pool as every existing
    // report page (BRANCH_MANAGER/AUDITOR/OWNER), now RBAC-enforced instead
    // of each page hardcoding its own role set.
    { role: RoleName.BRANCH_MANAGER, action: "reporting.shrinkage-rate.view", effect: PermissionEffect.VIEW },
    { role: RoleName.AUDITOR, action: "reporting.shrinkage-rate.view", effect: PermissionEffect.VIEW },
    { role: RoleName.OWNER, action: "reporting.shrinkage-rate.view", effect: PermissionEffect.VIEW },
    { role: RoleName.BRANCH_MANAGER, action: "reporting.cycle-count-compliance.view", effect: PermissionEffect.VIEW },
    { role: RoleName.AUDITOR, action: "reporting.cycle-count-compliance.view", effect: PermissionEffect.VIEW },
    { role: RoleName.OWNER, action: "reporting.cycle-count-compliance.view", effect: PermissionEffect.VIEW },
    { role: RoleName.BRANCH_MANAGER, action: "reporting.quarantine-disposal-aging.view", effect: PermissionEffect.VIEW },
    { role: RoleName.AUDITOR, action: "reporting.quarantine-disposal-aging.view", effect: PermissionEffect.VIEW },
    { role: RoleName.OWNER, action: "reporting.quarantine-disposal-aging.view", effect: PermissionEffect.VIEW },
    { role: RoleName.BRANCH_MANAGER, action: "reporting.damage-vs-shrinkage.view", effect: PermissionEffect.VIEW },
    { role: RoleName.AUDITOR, action: "reporting.damage-vs-shrinkage.view", effect: PermissionEffect.VIEW },
    { role: RoleName.OWNER, action: "reporting.damage-vs-shrinkage.view", effect: PermissionEffect.VIEW },

    // Low stock / out of stock alerts (BPD sec.14.5 — audience is explicitly
    // Br. Manager + Owner only, narrower than the usual reporting.* trio).
    { role: RoleName.BRANCH_MANAGER, action: "reporting.low-stock.view", effect: PermissionEffect.VIEW },
    { role: RoleName.OWNER, action: "reporting.low-stock.view", effect: PermissionEffect.VIEW },
    { role: RoleName.BRANCH_MANAGER, action: "reporting.low-stock.manage", effect: PermissionEffect.VIEW },
    { role: RoleName.OWNER, action: "reporting.low-stock.manage", effect: PermissionEffect.VIEW },

    // Daily Stock Movement Summary (BPD sec.14.5).
    { role: RoleName.BRANCH_MANAGER, action: "reporting.daily-stock-movement.view", effect: PermissionEffect.VIEW },
    { role: RoleName.AUDITOR, action: "reporting.daily-stock-movement.view", effect: PermissionEffect.VIEW },
    { role: RoleName.OWNER, action: "reporting.daily-stock-movement.view", effect: PermissionEffect.VIEW },

    // Weekly/monthly analytics (BPD sec.14.6).
    { role: RoleName.BRANCH_MANAGER, action: "reporting.variance-analysis.view", effect: PermissionEffect.VIEW },
    { role: RoleName.AUDITOR, action: "reporting.variance-analysis.view", effect: PermissionEffect.VIEW },
    { role: RoleName.OWNER, action: "reporting.variance-analysis.view", effect: PermissionEffect.VIEW },
    { role: RoleName.BRANCH_MANAGER, action: "reporting.trend-review.view", effect: PermissionEffect.VIEW },
    { role: RoleName.AUDITOR, action: "reporting.trend-review.view", effect: PermissionEffect.VIEW },
    { role: RoleName.OWNER, action: "reporting.trend-review.view", effect: PermissionEffect.VIEW },

    // Catalog management — new SKUs, not stock movement (that stays gated
    // behind Receiving/Adjustments as normal).
    { role: RoleName.BRANCH_MANAGER, action: "inventory.product.create", effect: PermissionEffect.CREATE },
    { role: RoleName.OWNER, action: "inventory.product.create", effect: PermissionEffect.CREATE },
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

  const seededVariants: Array<{ id: string; sellingPrice: number }> = [];
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
    seededVariants.push({ id: variant.id, sellingPrice: dp.sellingPrice });
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
    { id: "seed-booklet-stn-ilo-2026", documentType: "STN" }, // Stock Transfer Note (Phase 4) — also extended to CEB/MNL below via existingBookletDocTypes
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
    // Phase 4 — Inter-Branch Transfer sending-branch approval (MB-4). Same
    // recommended-default tier structure as RECEIVING/ADJUSTMENT — BPD
    // places the transit-loss risk on the sending branch (BR-089/BR-090),
    // the same reasoning that already routes those two through this table.
    {
      id: "seed-threshold-transfer-out-tier1",
      transactionType: "TRANSFER_OUT",
      minValue: 0,
      maxValue: 10000,
      requiredApproverRole: RoleName.BRANCH_MANAGER,
    },
    {
      id: "seed-threshold-transfer-out-tier2",
      transactionType: "TRANSFER_OUT",
      minValue: 10000.01,
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

  // Phase 4 — additional dev/test branches (build order step 2). Only "ILO"
  // existed before this; InterBranchTransfer needs at least one more real
  // branch, with its own warehouse/locations/opening stock, to be verified
  // end-to-end against a running instance rather than just unit-level.
  // branch_manager stays a single shared account (matches the existing
  // one-user-per-role convention) but is additionally granted BRANCH_MANAGER
  // via UserBranchRole at each new branch, so resolveBranchManager(branchId)
  // — which auto-assigns DiscrepancyCase.assignedTo for transfer variances,
  // reconciliation escalations, etc. — resolves correctly at every branch,
  // not just ILO. RBAC itself is role-only (assertPermission never checks
  // branch membership), so no other per-branch user duplication is needed.
  const branchManagerUser = await prisma.user.findUniqueOrThrow({ where: { username: "branch_manager" } });

  const additionalBranches: Array<{ code: string; name: string }> = [
    { code: "CEB", name: "Cebu Branch" },
    { code: "MNL", name: "Manila Branch" },
  ];

  const existingBookletDocTypes = booklets.map((b) => b.documentType);
  const OPENING_STOCK_QTY = 500; // seed-only convenience quantity, base units (PC)

  for (const ab of additionalBranches) {
    const newBranch = await prisma.branch.upsert({
      where: { code: ab.code },
      update: {},
      create: { code: ab.code, name: ab.name, status: "ACTIVE" },
    });

    const newWarehouse = await prisma.warehouse.upsert({
      where: { branchId_code: { branchId: newBranch.id, code: "WH1" } },
      update: {},
      create: { branchId: newBranch.id, code: "WH1", name: "Main Warehouse" },
    });

    const newLocations = await Promise.all(
      zones.map((zone) =>
        prisma.warehouseLocation.upsert({
          where: { warehouseId_code: { warehouseId: newWarehouse.id, code: zone } },
          update: {},
          create: { warehouseId: newWarehouse.id, zone, code: zone, name: `${zone} area` },
        }),
      ),
    );
    const storageLocation = newLocations.find((l) => l.zone === "STORAGE");
    if (!storageLocation) throw new Error(`Seed: no STORAGE location created for branch ${ab.code}`);

    for (const docType of existingBookletDocTypes) {
      await prisma.documentBookletRegistry.upsert({
        where: { id: `seed-booklet-${docType.toLowerCase()}-${ab.code.toLowerCase()}-2026` },
        update: {},
        create: {
          id: `seed-booklet-${docType.toLowerCase()}-${ab.code.toLowerCase()}-2026`,
          branchId: newBranch.id,
          documentType: docType,
          rangeStart: 1,
          rangeEnd: 999,
          registeredBy: owner.id,
        },
      });
    }

    await prisma.userBranchRole.upsert({
      where: {
        userId_branchId_role: { userId: branchManagerUser.id, branchId: newBranch.id, role: RoleName.BRANCH_MANAGER },
      },
      update: {},
      create: {
        userId: branchManagerUser.id,
        branchId: newBranch.id,
        role: RoleName.BRANCH_MANAGER,
        grantedBy: owner.id,
      },
    });

    // Opening stock, posted as a real OPENING_BALANCE ledger entry (not a
    // raw StockBalance upsert) so it carries a genuine hash-chained audit
    // trail — the movement type exists precisely for this ("built now;
    // posting path intentionally left unrouted in the UI until Phase 5
    // cutover", schema.prisma) and a seed script is exactly the sanctioned
    // way to use it before that UI exists.
    for (const sv of seededVariants) {
      const documentNumber = `OPENBAL-${ab.code}-${sv.id}`;
      const unitCostAtMovement = Math.round(sv.sellingPrice * 0.6 * 100) / 100; // seed-only approximate cost basis
      const payload = { branchId: newBranch.id, productVariantId: sv.id, quantity: OPENING_STOCK_QTY };
      await postLedgerEntry(prisma, {
        idempotency: {
          documentType: "OPENBAL",
          documentNumber,
          branchCode: newBranch.code,
          requestPayloadHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
        },
        branchId: newBranch.id,
        productVariantId: sv.id,
        warehouseLocationId: storageLocation.id,
        quantityDeltaBase: OPENING_STOCK_QTY,
        movementType: "OPENING_BALANCE",
        unitCostAtMovement,
        referenceType: "SeedOpeningBalance",
        referenceId: randomUUID(),
        documentNumber,
        performedBy: owner.id,
        approvedBy: owner.id,
      });
    }

    console.log(
      `Seeded additional branch "${newBranch.code}" (${newBranch.name}) with ${newLocations.length} warehouse locations, ${existingBookletDocTypes.length} document booklets, and opening stock for ${seededVariants.length} product variants.`,
    );
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
