// G-11 — Physical exit from the warehouse must have both a weight check
// against the expected load and an intact-seal check before a release can
// post — trusting either the driver's manifest or a decorative rubber
// stamp on file is not sufficient on its own.
// SYSTEM RULE: postSalesOrderRelease hard-blocks unless BOTH
// weightCheckPassed and sealVerifiedIntact are true, re-asserted at
// posting time (not merely recorded at the gate step).
// DETECTION: no weight-variance-by-driver pattern report exists.
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSalesOrderRelease, MissingUnitWeightError } from "../../src/server/application/wholesale/release";
import { recordGateCheck } from "../../src/server/application/wholesale/gateCheck";
import { postSalesOrderRelease, GateCheckPreconditionsNotMetError } from "../../src/server/application/wholesale/post";
import { buildExportTable, UnknownReportIdError } from "../../src/server/application/reporting/export/registry";
import { getIloBranch, getSeedVariant, getUserByRole, createSessionAndPin } from "./helpers/receiving";
import { draftToPendingReleaseApproval } from "./helpers/wholesale";

const prisma = new PrismaClient();

async function ensureUnitWeight(variantId: string, kg: number | null) {
  const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
  await prisma.product.update({ where: { id: variant.productId }, data: { unitWeightKg: kg } });
}

describe("G-11: gate weight check + seal verification before release posting", () => {
  it("[rule] createSalesOrderRelease requires the product to have a configured unitWeightKg", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    await ensureUnitWeight(variant.id, null);

    const { order, lineId } = await draftToPendingReleaseApproval(prisma, { branchId: branch.id, variantId: variant.id, qty: 4 });
    const { session, pinToken } = await createSessionAndPin(prisma, supervisor.id);

    await expect(
      createSalesOrderRelease(prisma, {
        actorUserId: supervisor.id,
        actorRole: "WAREHOUSE_SUPERVISOR",
        salesOrderId: order.id,
        lines: [{ salesOrderLineId: lineId, qty: 4 }],
        session,
        pinTokenId: pinToken.id,
      }),
    ).rejects.toThrow(MissingUnitWeightError);
  });

  it("[rule] a release with a failed weight check cannot post, even with an intact seal", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    const guard = await getUserByRole(prisma, "security_guard");
    const encoder = await getUserByRole(prisma, "encoder");
    await ensureUnitWeight(variant.id, 5);

    const { order, lineId } = await draftToPendingReleaseApproval(prisma, { branchId: branch.id, variantId: variant.id, qty: 4 });
    const { session, pinToken } = await createSessionAndPin(prisma, supervisor.id);
    const release = await createSalesOrderRelease(prisma, {
      actorUserId: supervisor.id,
      actorRole: "WAREHOUSE_SUPERVISOR",
      salesOrderId: order.id,
      lines: [{ salesOrderLineId: lineId, qty: 4 }],
      session,
      pinTokenId: pinToken.id,
    });

    // Weight way outside the ±5% band, seal intact — the weight failure
    // alone must be enough to block posting.
    await recordGateCheck(prisma, {
      actorUserId: guard.id,
      actorRole: "SECURITY_GUARD",
      releaseId: release.id,
      sealNumber: "SEAL-G11-1",
      sealVerifiedIntact: true,
      actualWeightKg: 999,
    });

    const { session: s2, pinToken: p2 } = await createSessionAndPin(prisma, encoder.id);
    await expect(
      postSalesOrderRelease(prisma, {
        actorUserId: encoder.id,
        actorRole: "ENCODER",
        releaseId: release.id,
        branchCode: branch.code,
        session: s2,
        pinTokenId: p2.id,
      }),
    ).rejects.toThrow(GateCheckPreconditionsNotMetError);
  });

  it("[rule] a release with a passed weight check but a broken seal cannot post", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    const guard = await getUserByRole(prisma, "security_guard");
    const encoder = await getUserByRole(prisma, "encoder");
    await ensureUnitWeight(variant.id, 5);

    const { order, lineId } = await draftToPendingReleaseApproval(prisma, { branchId: branch.id, variantId: variant.id, qty: 4 });
    const { session, pinToken } = await createSessionAndPin(prisma, supervisor.id);
    const release = await createSalesOrderRelease(prisma, {
      actorUserId: supervisor.id,
      actorRole: "WAREHOUSE_SUPERVISOR",
      salesOrderId: order.id,
      lines: [{ salesOrderLineId: lineId, qty: 4 }],
      session,
      pinTokenId: pinToken.id,
    });

    await recordGateCheck(prisma, {
      actorUserId: guard.id,
      actorRole: "SECURITY_GUARD",
      releaseId: release.id,
      sealNumber: "SEAL-G11-2",
      sealVerifiedIntact: false,
      actualWeightKg: 20, // 4 * 5kg — exactly on target
    });

    const { session: s2, pinToken: p2 } = await createSessionAndPin(prisma, encoder.id);
    await expect(
      postSalesOrderRelease(prisma, {
        actorUserId: encoder.id,
        actorRole: "ENCODER",
        releaseId: release.id,
        branchCode: branch.code,
        session: s2,
        pinTokenId: p2.id,
      }),
    ).rejects.toThrow(GateCheckPreconditionsNotMetError);
  });

  it("[rule] a release with a passed weight check AND an intact seal posts successfully", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    const guard = await getUserByRole(prisma, "security_guard");
    const encoder = await getUserByRole(prisma, "encoder");
    await ensureUnitWeight(variant.id, 5);

    const { order, lineId } = await draftToPendingReleaseApproval(prisma, { branchId: branch.id, variantId: variant.id, qty: 4 });
    const { session, pinToken } = await createSessionAndPin(prisma, supervisor.id);
    const release = await createSalesOrderRelease(prisma, {
      actorUserId: supervisor.id,
      actorRole: "WAREHOUSE_SUPERVISOR",
      salesOrderId: order.id,
      lines: [{ salesOrderLineId: lineId, qty: 4 }],
      session,
      pinTokenId: pinToken.id,
    });

    await recordGateCheck(prisma, {
      actorUserId: guard.id,
      actorRole: "SECURITY_GUARD",
      releaseId: release.id,
      sealNumber: "SEAL-G11-3",
      sealVerifiedIntact: true,
      actualWeightKg: 20,
    });

    const { session: s2, pinToken: p2 } = await createSessionAndPin(prisma, encoder.id);
    const posted = await postSalesOrderRelease(prisma, {
      actorUserId: encoder.id,
      actorRole: "ENCODER",
      releaseId: release.id,
      branchCode: branch.code,
      session: s2,
      pinTokenId: p2.id,
    });
    expect(posted.release.status).toBe("POSTED");
  });

  it("[GAP] DETECTION: no weight-variance-by-driver pattern report exists", async () => {
    try {
      await buildExportTable(prisma, { reportId: "gate-weight-variance-by-driver", actorRole: "OWNER" });
      throw new Error("[GAP] G-11 FAILED TO STAY A GAP: a weight-variance-by-driver report now exists in the export registry — this test should be replaced with a real detection test.");
    } catch (err) {
      if (err instanceof UnknownReportIdError) {
        throw new Error(
          "[GAP] G-11 DETECTION: no weight-variance-by-driver (or similar pattern) report is registered in " +
            "src/server/application/reporting/export/registry.ts — actualWeightKg and weightCheckPassed are " +
            "recorded per-release but never aggregated to surface a driver whose loads chronically fail the band.",
        );
      }
      throw err;
    }
  });
});
