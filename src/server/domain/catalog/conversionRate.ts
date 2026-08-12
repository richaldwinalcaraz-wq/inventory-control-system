import type { Prisma, PrismaClient } from "@prisma/client";

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * Thrown when a verification attempt violates the independence rule
 * (BR-068): a verifier can be neither the proposer nor the other witness.
 */
export class ConversionRateVerificationError extends Error {}

export interface ProposeConversionRateParams {
  productVariantId: string;
  fromUnitId: string;
  toUnitId: string;
  rate: number;
  proposedBy: string;
}

/**
 * Proposes a new conversion rate version. Starts PENDING_VERIFICATION —
 * never usable by a posting transaction until two independent witnesses
 * have confirmed the physical count (see verifyConversionRate).
 */
export async function proposeConversionRate(db: Db, params: ProposeConversionRateParams) {
  return db.conversionRateVersion.create({
    data: {
      productVariantId: params.productVariantId,
      fromUnitId: params.fromUnitId,
      toUnitId: params.toUnitId,
      rate: params.rate,
      proposedBy: params.proposedBy,
      status: "PENDING_VERIFICATION",
    },
  });
}

export interface VerifyConversionRateParams {
  conversionRateVersionId: string;
  verifiedBy: string;
}

/**
 * Records one witnessed physical verification. The second independent
 * verification activates the version and supersedes whatever was
 * previously ACTIVE for the same variant+unit pair, atomically.
 *
 * Independence (BR-068) is enforced here, not just by UI convention: a
 * verifier may not be the proposer, and the second verifier may not be
 * the first.
 */
export async function verifyConversionRate(tx: Prisma.TransactionClient, params: VerifyConversionRateParams) {
  const version = await tx.conversionRateVersion.findUniqueOrThrow({
    where: { id: params.conversionRateVersionId },
  });

  if (version.status !== "PENDING_VERIFICATION") {
    throw new ConversionRateVerificationError(
      `Conversion rate version ${version.id} is not awaiting verification (status=${version.status}).`,
    );
  }
  if (params.verifiedBy === version.proposedBy) {
    throw new ConversionRateVerificationError("The proposer cannot also verify their own proposed rate.");
  }

  if (!version.verifiedByUser1) {
    return tx.conversionRateVersion.update({
      where: { id: version.id },
      data: { verifiedByUser1: params.verifiedBy },
    });
  }

  if (version.verifiedByUser1 === params.verifiedBy) {
    throw new ConversionRateVerificationError("The second verifier must be independent of the first witness.");
  }

  // Second, independent verification — activate and supersede the prior
  // active version for this exact variant+unit pair in the same transaction.
  await tx.conversionRateVersion.updateMany({
    where: {
      productVariantId: version.productVariantId,
      fromUnitId: version.fromUnitId,
      toUnitId: version.toUnitId,
      status: "ACTIVE",
    },
    data: { status: "SUPERSEDED" },
  });

  return tx.conversionRateVersion.update({
    where: { id: version.id },
    data: {
      verifiedByUser2: params.verifiedBy,
      status: "ACTIVE",
      effectiveFrom: new Date(),
    },
  });
}
