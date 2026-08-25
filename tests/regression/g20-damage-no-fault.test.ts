// G-20 — Damage reporting must be genuinely no-fault (a disciplinary
// consequence for reporting damage teaches staff to hide it instead), but
// a location or product with a suspiciously high shrinkage-to-damage
// ratio must still be visible for review.
// SYSTEM RULE: DamageReport/createDamageReport has no disciplinary or
// punitive field anywhere — enforced by absence, not a flag.
// DETECTION: getDamageVsShrinkageReport (the damage-vs-shrinkage report)
// aggregates DamageReport counts against ADJ_01 shortage-adjustment
// counts/value per (branch, product, location), flagging a location as
// disproportionate when damage is suspiciously under-reported relative to
// shrinkage write-offs.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createDamageReport } from "../../src/server/application/disposal/report";
import { requestAdjustment } from "../../src/server/application/adjustment/request";
import { investigateAdjustment } from "../../src/server/application/adjustment/investigate";
import { approveAdjustment } from "../../src/server/application/adjustment/approve";
import { postAdjustment } from "../../src/server/application/adjustment/post";
import { getDamageVsShrinkageReport } from "../../src/server/application/reporting/damageVsShrinkage";
import { getIloBranch, getSeedVariant, getUserByRole, createSessionAndPin, createEphemeralUser } from "./helpers/receiving";

const prisma = new PrismaClient();

describe("G-20: no-fault damage reporting + damage-vs-shrinkage detection", () => {
  it("[rule] DamageReport has no disciplinary/punitive field — confirmed against the live schema", () => {
    const schemaPath = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url));
    const content = readFileSync(schemaPath, "utf-8");
    const match = content.match(/model DamageReport \{([\s\S]*?)\n\}/);
    if (!match) throw new Error("Model DamageReport not found in schema.prisma");
    const fields = match[1] ?? "";
    expect(/disciplin|penal|infraction|warning|writeup|write-up|demerit/i.test(fields)).toBe(false);
  });

  it("[rule] getDamageVsShrinkageReport aggregates damage counts against ADJ_01 shortage-adjustment counts/value for the same (branch, product, location)", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    // A fresh throwaway requester, not the shared seeded "encoder" account
    // — its rolling 7-day adjustment total is permanently elevated from
    // other finding files' test history (see G-21), which would push even
    // this tiny ADJ_01 into the OWNER tier and mask the assertion below.
    const requester = await createEphemeralUser(prisma, { branchId: branch.id, role: "ENCODER", label: "g20-requester" });
    const poster = await getUserByRole(prisma, "encoder");
    const branchManager = await getUserByRole(prisma, "branch_manager");
    const location = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId: branch.id } } });

    await createDamageReport(prisma, {
      actorUserId: supervisor.id,
      actorRole: "WAREHOUSE_SUPERVISOR",
      branchId: branch.id,
      productVariantId: variant.id,
      warehouseLocationId: location.id,
      sourceType: "STORAGE",
      quantity: 1,
      cause: "G-20 test: one damage report to compare against a shortage adjustment.",
    });

    const req = await requestAdjustment(prisma, {
      actorUserId: requester.id,
      actorRole: "ENCODER",
      branchId: branch.id,
      productVariantId: variant.id,
      warehouseLocationId: location.id,
      reasonCode: "ADJ_01",
      quantityDelta: -1,
      reconciliationNotes: "G-20 test: recount confirmed missing 1 unit, unrelated to the damage report above.",
    });
    await investigateAdjustment(prisma, { actorUserId: branchManager.id, actorRole: "BRANCH_MANAGER", adjustmentRequestId: req.id, outcome: "PROCEED", investigationNotes: "Investigated." });
    const { session: s1, pinToken: p1 } = await createSessionAndPin(prisma, branchManager.id);
    await approveAdjustment(prisma, { actorUserId: branchManager.id, actorRole: "BRANCH_MANAGER", adjustmentRequestId: req.id, outcome: "APPROVE", session: s1, pinTokenId: p1.id });
    const { session: s2, pinToken: p2 } = await createSessionAndPin(prisma, poster.id);
    await postAdjustment(prisma, { actorUserId: poster.id, actorRole: "ENCODER", adjustmentRequestId: req.id, branchCode: branch.code, session: s2, pinTokenId: p2.id });

    const rows = await getDamageVsShrinkageReport(prisma, { actorRole: "OWNER" });
    const row = rows.find((r) => r.branchId === branch.id && r.productVariantId === variant.id && r.warehouseLocationId === location.id);
    expect(row).toBeDefined();
    expect(row!.damageCount).toBeGreaterThanOrEqual(1);
    expect(row!.adjCount).toBeGreaterThanOrEqual(1);
    expect(row!.disproportionate).toBe(row!.damageCount === 0 || row!.damageCount / row!.adjCount < 0.5);
  });
});
