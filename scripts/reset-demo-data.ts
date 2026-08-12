// One-off: wipe transactional data left over from automated test runs so the
// Receiving list/gate log/ledger start clean for a client demo. Master data
// (branch, categories, supplier, units, locations, users, permissions,
// approval thresholds, booklet registry) is left untouched.
import { prisma } from "../src/lib/prisma";

async function main() {
  await prisma.$transaction([
    prisma.transactionEvidence.deleteMany({}),
    prisma.countSlipLine.deleteMany({}),
    prisma.countSlip.deleteMany({}),
    prisma.receivingReportLine.deleteMany({}),
    prisma.discrepancyCase.deleteMany({}),
    prisma.receivingReport.deleteMany({}),
    prisma.stockLedger.deleteMany({}),
    prisma.documentNumber.deleteMany({}),
    prisma.documentSequence.deleteMany({}),
    prisma.idempotencyKey.deleteMany({}),
    prisma.gateLogEntry.deleteMany({}),
    prisma.stockBalance.deleteMany({}),
    prisma.transactionPinToken.deleteMany({}),
    prisma.emergencyElevation.deleteMany({}),
    prisma.auditLog.deleteMany({}),
  ]);

  // Stray variant created by an opening-balance race test, sharing the seed
  // product but not part of the seed itself.
  const strayVariant = await prisma.productVariant.findUnique({
    where: { sku: "TEST-OB-RACE-SKU" },
    select: { id: true, productId: true },
  });
  if (strayVariant) {
    await prisma.conversionRateVersion.deleteMany({ where: { productVariantId: strayVariant.id } });
    await prisma.productVariant.delete({ where: { id: strayVariant.id } });
    const siblings = await prisma.productVariant.count({ where: { productId: strayVariant.productId } });
    if (siblings === 0) {
      await prisma.product.delete({ where: { id: strayVariant.productId } });
    }
  }

  console.log("Demo state cleaned: transactional tables emptied, stray test SKU removed.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
