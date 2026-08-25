// G-10 — Spot recount selection must be genuinely random, unscheduled, and
// witnessed by someone with no role in that day's picking/checking/
// authorization at the branch.
// SYSTEM RULE: rollSpotRecount (crypto.randomInt, never Math.random) flags
// orders crossing a materiality threshold at a fixed rate; once flagged,
// authorizeSalesOrderRelease hard-blocks until a SPOT_RECOUNT CountSlip
// exists, submitted by a day-and-branch-scoped-eligible witness.
// DETECTION: no spot-check-outcome-by-driver/picker pattern report exists.
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { rollSpotRecount, assertEligibleSpotRecountWitness, NoEligibleSpotRecountWitnessError } from "../../src/server/domain/wholesale/spotRecount";
import { authorizeSalesOrderRelease, SpotRecountRequiredError } from "../../src/server/application/wholesale/authorizeRelease";
import { submitSpotRecount } from "../../src/server/application/wholesale/spotRecount";
import { buildExportTable, UnknownReportIdError } from "../../src/server/application/reporting/export/registry";
import { getIloBranch, getSeedVariant, getUserByRole } from "./helpers/receiving";
import { draftToChecked } from "./helpers/wholesale";

const prisma = new PrismaClient();

describe("G-10: spot recount (unscheduled, random, independently witnessed)", () => {
  it("[rule] rollSpotRecount never flags an order below the materiality threshold", () => {
    for (let i = 0; i < 20; i++) {
      expect(rollSpotRecount(19999.99)).toBe(false);
    }
  });

  it("[rule] once flagged, authorizeSalesOrderRelease is blocked until a SPOT_RECOUNT CountSlip exists, then succeeds", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    const auditor = await getUserByRole(prisma, "auditor");

    const { order } = await draftToChecked(prisma, { branchId: branch.id, variantId: variant.id, qty: 5 });
    // Force the flag deterministically — rollSpotRecount's own randomness is
    // exercised separately above; this isolates the gate-enforcement logic.
    await prisma.salesOrder.update({ where: { id: order.id }, data: { spotRecountRequired: true, spotRecountRolledAt: new Date() } });

    await expect(
      authorizeSalesOrderRelease(prisma, { actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", salesOrderId: order.id }),
    ).rejects.toThrow(SpotRecountRequiredError);

    await submitSpotRecount(prisma, {
      actorUserId: auditor.id,
      actorRole: "AUDITOR",
      salesOrderId: order.id,
      lines: [{ productVariantId: variant.id, countedQty: 5 }],
    });

    const authorized = await authorizeSalesOrderRelease(prisma, { actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", salesOrderId: order.id });
    expect(authorized.status).toBe("PENDING_RELEASE_APPROVAL");
  });

  it("[rule] the picker of an order is NOT an eligible spot-recount witness for that branch today (day-and-branch-scoped SoD)", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const picker = await getUserByRole(prisma, "warehouse_picker");
    await draftToChecked(prisma, { branchId: branch.id, variantId: variant.id, qty: 3 });

    await expect(
      prisma.$transaction((tx) => assertEligibleSpotRecountWitness(tx, { branchId: branch.id, candidateUserId: picker.id })),
    ).rejects.toThrow(NoEligibleSpotRecountWitnessError);
  });

  it("[GAP] DETECTION: no spot-check-outcome-by-driver/picker pattern report exists", async () => {
    try {
      await buildExportTable(prisma, { reportId: "spot-recount-outcomes", actorRole: "OWNER" });
      throw new Error("[GAP] G-10 FAILED TO STAY A GAP: a 'spot-recount-outcomes' report now exists in the export registry — this test should be replaced with a real detection test.");
    } catch (err) {
      if (err instanceof UnknownReportIdError) {
        throw new Error(
          "[GAP] G-10 DETECTION: no spot-check-outcome-by-driver/picker pattern report is registered in " +
            "src/server/application/reporting/export/registry.ts — spot recount results are recorded per-order " +
            "but never aggregated to surface a picker/driver who is suspiciously never flagged or always passes.",
        );
      }
      throw err;
    }
  });
});
