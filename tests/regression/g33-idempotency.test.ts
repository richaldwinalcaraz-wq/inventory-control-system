// G-33 — No explicit idempotency requirement — network retries or duplicate
// submissions can double-post the same physical movement.
// SYSTEM RULE: every posting is keyed (documentType, documentNumber,
// branchCode); a retried request with the identical payload is a no-op, a
// genuinely different request reusing the same key is rejected outright.
// DETECTION: mismatch/in-progress rejections aren't logged anywhere reviewable.
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { postLedgerEntry, IdempotencyPayloadMismatchError, IdempotencyInProgressError } from "../../src/server/domain/ledger/postLedgerEntry";
import { getIloBranch, getSeedVariant, getUserByRole } from "./helpers/receiving";

const prisma = new PrismaClient();

async function baseParams() {
  const branch = await getIloBranch(prisma);
  const variant = await getSeedVariant(prisma);
  const owner = await getUserByRole(prisma, "owner");
  const location = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId: branch.id } } });
  return { branch, variant, owner, location };
}

describe("G-33: idempotency", () => {
  it("[rule] an identical retry (same key, same payload hash) is a no-op — not a second ledger entry", async () => {
    const { branch, variant, owner, location } = await baseParams();
    const idempotency = { documentType: "G33TEST", documentNumber: `G33-${Date.now()}`, branchCode: branch.code, requestPayloadHash: "fixed-payload-hash-abc" };
    const params = {
      idempotency,
      branchId: branch.id,
      productVariantId: variant.id,
      warehouseLocationId: location.id,
      quantityDeltaBase: 1,
      movementType: "ADJUSTMENT_IN" as const,
      unitCostAtMovement: 1,
      referenceType: "RegressionTestG33",
      referenceId: `g33-${Date.now()}`,
      documentNumber: idempotency.documentNumber,
      performedBy: owner.id,
    };

    const first = await postLedgerEntry(prisma, params);
    expect(first.noop).toBe(false);

    const retry = await postLedgerEntry(prisma, params);
    expect(retry.noop).toBe(true);
    expect(retry.ledger.id).toBe(first.ledger.id);
    expect(retry.ledger.sequenceNo).toBe(first.ledger.sequenceNo);

    const ledgerCount = await prisma.stockLedger.count({ where: { documentNumber: idempotency.documentNumber } });
    expect(ledgerCount).toBe(1);
  });

  it("[rule] the same key with a genuinely DIFFERENT payload is rejected as a duplicate submission, not silently accepted", async () => {
    const { branch, variant, owner, location } = await baseParams();
    const idempotency = { documentType: "G33TEST", documentNumber: `G33-MISMATCH-${Date.now()}`, branchCode: branch.code, requestPayloadHash: "payload-hash-A" };
    const baseline = {
      branchId: branch.id,
      productVariantId: variant.id,
      warehouseLocationId: location.id,
      quantityDeltaBase: 1,
      movementType: "ADJUSTMENT_IN" as const,
      unitCostAtMovement: 1,
      referenceType: "RegressionTestG33",
      referenceId: `g33-mismatch-${Date.now()}`,
      documentNumber: idempotency.documentNumber,
      performedBy: owner.id,
    };

    await postLedgerEntry(prisma, { idempotency, ...baseline });

    await expect(
      postLedgerEntry(prisma, { idempotency: { ...idempotency, requestPayloadHash: "payload-hash-B-a-different-request" }, ...baseline, quantityDeltaBase: 999 }),
    ).rejects.toThrow(IdempotencyPayloadMismatchError);
  });

  it("[rule] a key already IN_PROGRESS (a genuinely concurrent request still mid-flight) is rejected, not queued or double-run", async () => {
    const { branch, owner } = await baseParams();
    const documentNumber = `G33-INPROGRESS-${Date.now()}`;
    // Simulates the precondition a real concurrent second request would
    // observe — the winning request's own INSERT ... ON CONFLICT, mid-flight.
    await prisma.$executeRaw`
      INSERT INTO idempotency_key (id, document_type, document_number, branch_code, request_payload_hash, status)
      VALUES (${randomUUID()}, 'G33TEST', ${documentNumber}, ${branch.code}, 'in-flight-hash', 'IN_PROGRESS')
    `;

    const variant = await getSeedVariant(prisma);
    const location = await prisma.warehouseLocation.findFirstOrThrow({ where: { zone: "STORAGE", warehouse: { branchId: branch.id } } });

    await expect(
      postLedgerEntry(prisma, {
        idempotency: { documentType: "G33TEST", documentNumber, branchCode: branch.code, requestPayloadHash: "in-flight-hash" },
        branchId: branch.id,
        productVariantId: variant.id,
        warehouseLocationId: location.id,
        quantityDeltaBase: 1,
        movementType: "ADJUSTMENT_IN",
        unitCostAtMovement: 1,
        referenceType: "RegressionTestG33",
        referenceId: `g33-inprogress-${Date.now()}`,
        documentNumber,
        performedBy: owner.id,
      }),
    ).rejects.toThrow(IdempotencyInProgressError);
  });

  it("[GAP] DETECTION: rejected duplicate/in-progress submissions aren't logged anywhere reviewable", () => {
    throw new Error(
      "[GAP] G-33 DETECTION: IdempotencyPayloadMismatchError and IdempotencyInProgressError are both thrown as " +
        "plain HTTP errors and never written to AuditLog or any report — a spike in duplicate-submission attempts " +
        "(a real signal of a broken client, a replay attack, or a confused operator) is currently invisible to review.",
    );
  });
});
