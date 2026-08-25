// G-19 — Scrap sales are a real leakage vector (an easy way to sell real
// stock for a token price to a friendly buyer) unless every sale is
// justified against an independent price signal, and anything below that
// signal is hard-blocked pending Owner sign-off.
// SYSTEM RULE (DC-3): recordScrapSaleQuote requires either two comparative
// quotes on file (with a live-captured photo of the quote documents) or a
// match against the ScrapBuyerBenchmark master list; a below-benchmark
// sale cannot post without a distinct Owner approval action first.
// DETECTION: no scrap-price trend report exists.
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createDamageReport } from "../../src/server/application/disposal/report";
import { createDisposalCertificate } from "../../src/server/application/disposal/createCertificate";
import {
  recordScrapSaleQuote,
  approveScrapSaleBelowBenchmark,
  postScrapSaleCertificate,
  ScrapSaleJustificationRequiredError,
  QuoteEvidenceRequiredError,
  ScrapSaleApprovalRequiredError,
} from "../../src/server/application/disposal/scrapSale";
import { buildExportTable, UnknownReportIdError } from "../../src/server/application/reporting/export/registry";
import { getIloBranch, getSeedVariant, getUserByRole, createSessionAndPin } from "./helpers/receiving";

const prisma = new PrismaClient();

async function draftScrapCertificate(branchId: string, variantId: string, qty: number) {
  const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
  const auditor = await getUserByRole(prisma, "auditor");
  const location = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId } } });

  const report = await createDamageReport(prisma, {
    actorUserId: supervisor.id,
    actorRole: "WAREHOUSE_SUPERVISOR",
    branchId,
    productVariantId: variantId,
    warehouseLocationId: location.id,
    sourceType: "STORAGE",
    quantity: qty,
    cause: "G-19 test: unsellable, headed for scrap sale.",
  });

  const cert = await createDisposalCertificate(prisma, {
    actorUserId: supervisor.id,
    actorRole: "WAREHOUSE_SUPERVISOR",
    damageReportId: report.id,
    disposition: "SCRAP_SALE",
    quantity: qty,
    witness1Id: supervisor.id,
    witness2Id: auditor.id,
  });

  return { report, cert, supervisor };
}

describe("G-19: scrap sale, below-benchmark hard block", () => {
  it("[rule] neither two quotes nor a matched benchmark is provided — ScrapSaleJustificationRequiredError", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const { cert, supervisor } = await draftScrapCertificate(branch.id, variant.id, 5);

    await expect(
      recordScrapSaleQuote(prisma, { actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", dcId: cert.id, buyerName: "Random Buyer", pricePerKg: 10, weightKg: 5 }),
    ).rejects.toThrow(ScrapSaleJustificationRequiredError);
  });

  it("[rule] two quotes on file without a live-captured photo is rejected — QuoteEvidenceRequiredError", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const { cert, supervisor } = await draftScrapCertificate(branch.id, variant.id, 5);

    await expect(
      recordScrapSaleQuote(prisma, {
        actorUserId: supervisor.id,
        actorRole: "WAREHOUSE_SUPERVISOR",
        dcId: cert.id,
        buyerName: "Random Buyer",
        pricePerKg: 10,
        weightKg: 5,
        quotesOnFile: [{ buyerName: "Buyer A", pricePerKg: 12 }, { buyerName: "Buyer B", pricePerKg: 11 }],
      }),
    ).rejects.toThrow(QuoteEvidenceRequiredError);
  });

  it("[rule] a below-benchmark scrap sale cannot post without a distinct Owner approval action, and posts once approved", async () => {
    const branch = await getIloBranch(prisma);
    const variant = await getSeedVariant(prisma);
    const owner = await getUserByRole(prisma, "owner");
    const { cert, supervisor } = await draftScrapCertificate(branch.id, variant.id, 5);

    const benchmark = await prisma.scrapBuyerBenchmark.create({
      data: { buyerName: `G-19 Benchmark Buyer ${Date.now()}`, benchmarkRatePerKg: 20, approvedBy: owner.id, effectiveFrom: new Date() },
    });

    const record = await recordScrapSaleQuote(prisma, {
      actorUserId: supervisor.id,
      actorRole: "WAREHOUSE_SUPERVISOR",
      dcId: cert.id,
      buyerName: "Below-Benchmark Buyer",
      pricePerKg: 10, // below the ₱20/kg benchmark
      weightKg: 5,
      scrapBuyerBenchmarkId: benchmark.id,
    });
    expect(record.belowBenchmark).toBe(true);

    const { session: s1, pinToken: p1 } = await createSessionAndPin(prisma, supervisor.id);
    await expect(
      postScrapSaleCertificate(prisma, { actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", branchCode: branch.code, dcId: cert.id, session: s1, pinTokenId: p1.id }),
    ).rejects.toThrow(ScrapSaleApprovalRequiredError);

    const { session: s2, pinToken: p2 } = await createSessionAndPin(prisma, owner.id);
    await approveScrapSaleBelowBenchmark(prisma, { actorUserId: owner.id, actorRole: "OWNER", dcId: cert.id, session: s2, pinTokenId: p2.id });

    const { session: s3, pinToken: p3 } = await createSessionAndPin(prisma, supervisor.id);
    const posted = await postScrapSaleCertificate(prisma, { actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", branchCode: branch.code, dcId: cert.id, session: s3, pinTokenId: p3.id });
    expect(posted.disposalCertificate.status).toBe("POSTED");
  });

  it("[GAP] DETECTION: no scrap-price trend report exists", async () => {
    try {
      await buildExportTable(prisma, { reportId: "scrap-price-trend", actorRole: "OWNER" });
      throw new Error("[GAP] G-19 FAILED TO STAY A GAP: a scrap-price-trend report now exists in the export registry — replace this test with a real detection test.");
    } catch (err) {
      if (err instanceof UnknownReportIdError) {
        throw new Error(
          "[GAP] G-19 DETECTION: no scrap-price-trend (or similar pattern) report is registered in " +
            "src/server/application/reporting/export/registry.ts — ScrapSaleRecord.pricePerKg is recorded per-sale " +
            "but never aggregated over time to surface a buyer or product whose scrap price is quietly drifting down.",
        );
      }
      throw err;
    }
  });
});
