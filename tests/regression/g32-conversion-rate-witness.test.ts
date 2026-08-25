// G-32 — An incorrect conversion rate, once used, is permanently locked in
// with only a single person's say-so at creation.
// SYSTEM RULE (BR-068): two independent witnessed verifications required —
// proposer excluded, second verifier must differ from the first — before a
// rate activates.
// DETECTION: no periodic re-verification of an already-ACTIVE rate exists.
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { proposeConversionRate, verifyConversionRate, ConversionRateVerificationError } from "../../src/server/domain/catalog/conversionRate";
import { getSeedVariant, getUserByRole } from "./helpers/receiving";

const prisma = new PrismaClient();
const createdVersionIds: string[] = [];

async function getTwoUnits() {
  const units = await prisma.unitOfMeasure.findMany({ take: 2, orderBy: { code: "asc" } });
  if (units.length < 2) throw new Error("Seed data must have at least 2 units of measure.");
  return { fromUnit: units[0]!, toUnit: units[1]! };
}

describe("G-32: conversion rate witnessed verification", () => {
  it("[rule] the proposer cannot also verify their own proposed rate", async () => {
    const variant = await getSeedVariant(prisma);
    const { fromUnit, toUnit } = await getTwoUnits();
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");

    const version = await proposeConversionRate(prisma, { productVariantId: variant.id, fromUnitId: fromUnit.id, toUnitId: toUnit.id, rate: 500, proposedBy: supervisor.id });
    createdVersionIds.push(version.id);

    await expect(verifyConversionRate(prisma, { conversionRateVersionId: version.id, verifiedBy: supervisor.id })).rejects.toThrow(ConversionRateVerificationError);
  });

  it("[rule] a single verification is not enough — status stays PENDING_VERIFICATION", async () => {
    const variant = await getSeedVariant(prisma);
    const { fromUnit, toUnit } = await getTwoUnits();
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    const witness1 = await getUserByRole(prisma, "warehouse_receiver");

    const version = await proposeConversionRate(prisma, { productVariantId: variant.id, fromUnitId: fromUnit.id, toUnitId: toUnit.id, rate: 500, proposedBy: supervisor.id });
    createdVersionIds.push(version.id);

    const afterFirst = await verifyConversionRate(prisma, { conversionRateVersionId: version.id, verifiedBy: witness1.id });
    expect(afterFirst.status).toBe("PENDING_VERIFICATION");
    expect(afterFirst.verifiedByUser1).toBe(witness1.id);
  });

  it("[rule] the second verifier must be independent of the first — same person twice is rejected", async () => {
    const variant = await getSeedVariant(prisma);
    const { fromUnit, toUnit } = await getTwoUnits();
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    const witness1 = await getUserByRole(prisma, "warehouse_receiver");

    const version = await proposeConversionRate(prisma, { productVariantId: variant.id, fromUnitId: fromUnit.id, toUnitId: toUnit.id, rate: 500, proposedBy: supervisor.id });
    createdVersionIds.push(version.id);
    await verifyConversionRate(prisma, { conversionRateVersionId: version.id, verifiedBy: witness1.id });

    await expect(verifyConversionRate(prisma, { conversionRateVersionId: version.id, verifiedBy: witness1.id })).rejects.toThrow(ConversionRateVerificationError);
  });

  it("[rule] two independent witnesses activate the rate", async () => {
    const variant = await getSeedVariant(prisma);
    const { fromUnit, toUnit } = await getTwoUnits();
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    const witness1 = await getUserByRole(prisma, "warehouse_receiver");
    const witness2 = await getUserByRole(prisma, "warehouse_checker");

    const version = await proposeConversionRate(prisma, { productVariantId: variant.id, fromUnitId: fromUnit.id, toUnitId: toUnit.id, rate: 500, proposedBy: supervisor.id });
    createdVersionIds.push(version.id);
    await verifyConversionRate(prisma, { conversionRateVersionId: version.id, verifiedBy: witness1.id });
    const activated = await verifyConversionRate(prisma, { conversionRateVersionId: version.id, verifiedBy: witness2.id });

    expect(activated.status).toBe("ACTIVE");
    expect(activated.verifiedByUser2).toBe(witness2.id);
  });

  it("[GAP] DETECTION: no periodic re-verification of an already-ACTIVE conversion rate exists", () => {
    throw new Error(
      "[GAP] G-32 DETECTION: once a ConversionRateVersion reaches ACTIVE, nothing in src/server/application ever " +
        "re-checks it against physical reality again — a rate that was correct at activation but silently drifts " +
        "wrong (e.g. after a supplier repackaging change) has no scheduled or triggered re-verification mechanism.",
    );
  });
});

afterAll(async () => {
  await prisma.conversionRateVersion.deleteMany({ where: { id: { in: createdVersionIds } } });
  await prisma.$disconnect();
});
