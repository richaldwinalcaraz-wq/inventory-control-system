import { randomUUID, createHash } from "node:crypto";
import type { MovementType, Prisma, PrismaClient } from "@prisma/client";

export const GENESIS_HASH = "0".repeat(64);

/** A different request already used this exact idempotency key — a real duplicate, not a retry. */
export class IdempotencyPayloadMismatchError extends Error {}
/** A genuinely concurrent request for the same key is still in flight. */
export class IdempotencyInProgressError extends Error {}

/**
 * A negative movement would take stock_balance below zero and no
 * Owner-approved override was supplied. Blocked, full stop — see Phase 2
 * plan sec.1 for why this is an app-layer guard, not a DB CHECK constraint
 * (the override path deliberately needs to let balance go negative).
 */
export class NegativeStockError extends Error {
  constructor(
    public readonly currentQty: string,
    public readonly requestedDelta: string,
    public readonly resultingQty: string,
  ) {
    super(
      `Movement would take stock balance negative: current=${currentQty}, delta=${requestedDelta}, resulting=${resultingQty}. Blocked — no override was authorized.`,
    );
  }
}

export interface PostLedgerEntryParams {
  idempotency: {
    documentType: string;
    documentNumber: string;
    branchCode: string;
    requestPayloadHash: string;
  };
  branchId: string;
  productVariantId: string;
  warehouseLocationId: string;
  batchId?: string;
  quantityDeltaBase: number | string;
  movementType: MovementType;
  unitCostAtMovement: number | string;
  conversionRateVersionId?: string | null;
  referenceType: string;
  referenceId: string;
  documentNumber: string;
  reasonCode?: string | null;
  performedBy: string;
  approvedBy?: string | null;
  /**
   * Owner-only escape hatch for the negative-stock guard, for rare
   * legitimate timing cases (e.g. a dispatch that must leave before its
   * formal posting). The caller is responsible for gating this behind a
   * fresh PIN token and an Owner-role check at the application layer —
   * this domain function trusts whatever it's handed, it doesn't itself
   * re-verify the approver's role. When used, the ledger row's reasonCode
   * is always forced to "NEGATIVE_STOCK_OVERRIDE" and approvedBy to this
   * value, so usage is queryable later regardless of what the caller also
   * passed in `reasonCode`/`approvedBy`.
   */
  allowNegativeStockOverride?: { approvedBy: string; reason: string };
}

export interface LedgerRow {
  id: bigint;
  sequenceNo: bigint;
  prevHash: string;
  rowHash: string;
}

export interface PostLedgerEntryResult {
  /** true if this call was a no-op replay of an already-completed request. */
  noop: boolean;
  ledger: LedgerRow;
}

// Fixed key order + fixed string formatting, so the same logical row
// always hashes identically regardless of how the JS object was built.
// Shared with the chain-verification job — never fork this into a second
// copy of the hashing logic.
const CANONICAL_FIELD_ORDER = [
  "branchId",
  "productVariantId",
  "warehouseLocationId",
  "batchId",
  "quantityDeltaBase",
  "movementType",
  "unitCostAtMovement",
  "conversionRateVersionId",
  "referenceType",
  "referenceId",
  "documentNumber",
  "reasonCode",
  "performedBy",
  "approvedBy",
  "sequenceNo",
  "createdAt",
  "prevHash",
] as const;

export type CanonicalLedgerFields = Record<(typeof CANONICAL_FIELD_ORDER)[number], string | number | null>;

export function canonicalLedgerPayload(fields: CanonicalLedgerFields): string {
  const canonical: Record<string, string> = {};
  for (const key of CANONICAL_FIELD_ORDER) {
    const value = fields[key];
    canonical[key] = value === null || value === undefined ? "" : String(value);
  }
  return JSON.stringify(canonical);
}

export function hashLedgerRow(fields: CanonicalLedgerFields): string {
  return createHash("sha256").update(canonicalLedgerPayload(fields)).digest("hex");
}

/**
 * Posts a single stock movement: claims idempotency, appends to the
 * hash-chained stock_ledger, and updates the derived stock_balance cache —
 * all inside one DB transaction, so partial application is impossible.
 *
 * Composition order is the load-bearing invariant here: the idempotency
 * claim happens first, and chain/balance logic only ever runs in the
 * "claimed a fresh key" branch. A no-op reply never touches the chain.
 */
export async function postLedgerEntry(
  prismaClient: PrismaClient,
  params: PostLedgerEntryParams,
): Promise<PostLedgerEntryResult> {
  return prismaClient.$transaction((tx) => postLedgerEntryInTx(tx, params));
}

/**
 * Same logic as postLedgerEntry, but takes an already-open transaction
 * client instead of managing its own transaction. Use this when a caller
 * needs several ledger rows (or a ledger row plus other writes, like
 * document-number issuance) to commit or roll back together atomically —
 * Prisma doesn't support nesting one $transaction inside another, so the
 * caller's own $transaction must own the whole unit of work. Receiving's
 * multi-line encode step (Step 10) is the reason this split exists.
 */
export async function postLedgerEntryInTx(
  tx: Prisma.TransactionClient,
  params: PostLedgerEntryParams,
): Promise<PostLedgerEntryResult> {
  {
    const claim = await claimIdempotencyKey(tx, params.idempotency);
    if (claim.alreadyCompleted) {
      const existingLedger = await tx.stockLedger.findUniqueOrThrow({
        where: { idempotencyKeyId: claim.id },
        select: { id: true, sequenceNo: true, prevHash: true, rowHash: true },
      });
      return { noop: true, ledger: existingLedger };
    }

    const batchId = params.batchId ?? "";

    // Chain-tail lock: serializes concurrent posters across the whole
    // (single, global) chain. Fine at this client's volume — see plan
    // sec.3 for the documented tradeoff if this ever needs to scale.
    const tailRows = await tx.$queryRaw<{ sequence_no: bigint; row_hash: string }[]>`
      SELECT sequence_no, row_hash FROM stock_ledger ORDER BY sequence_no DESC LIMIT 1 FOR UPDATE
    `;
    const tail = tailRows[0];
    const prevHash = tail?.row_hash ?? GENESIS_HASH;
    const sequenceNo = (tail?.sequence_no ?? 0n) + 1n;
    const createdAt = new Date();

    // Negative-stock guard. Deliberately an explicit row lock on the
    // specific stock_balance row here, rather than riding the tail lock's
    // incidental global serialization above — that serialization is a
    // documented scaling tradeoff (see Phase 1 plan sec.3) a future
    // engineer could narrow without realizing this guard's correctness
    // depended on it staying global. Costs nothing extra since the upsert
    // below touches this same row moments later anyway.
    const quantityDelta = Number(params.quantityDeltaBase);
    const usingNegativeStockOverride = quantityDelta < 0 && Boolean(params.allowNegativeStockOverride);
    if (quantityDelta < 0) {
      const balanceRows = await tx.$queryRaw<{ quantity_on_hand: string }[]>`
        SELECT quantity_on_hand FROM stock_balance
        WHERE product_variant_id = ${params.productVariantId}
          AND warehouse_location_id = ${params.warehouseLocationId}
          AND batch_id = ${batchId}
        FOR UPDATE
      `;
      const currentQty = balanceRows[0] ? Number(balanceRows[0].quantity_on_hand) : 0;
      const resultingQty = currentQty + quantityDelta;
      if (resultingQty < 0 && !usingNegativeStockOverride) {
        throw new NegativeStockError(currentQty.toString(), quantityDelta.toString(), resultingQty.toString());
      }
    }

    // When the override is used, the ledger row always records that fact
    // regardless of whatever reasonCode/approvedBy the caller also passed —
    // usage must be queryable later (Phase 4's dashboard promise), not
    // inferable only from a negative balance after the fact.
    const effectiveReasonCode = usingNegativeStockOverride ? "NEGATIVE_STOCK_OVERRIDE" : (params.reasonCode ?? null);
    const effectiveApprovedBy = usingNegativeStockOverride
      ? params.allowNegativeStockOverride!.approvedBy
      : (params.approvedBy ?? null);

    const rowHash = hashLedgerRow({
      branchId: params.branchId,
      productVariantId: params.productVariantId,
      warehouseLocationId: params.warehouseLocationId,
      batchId,
      quantityDeltaBase: params.quantityDeltaBase,
      movementType: params.movementType,
      unitCostAtMovement: params.unitCostAtMovement,
      conversionRateVersionId: params.conversionRateVersionId ?? null,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      documentNumber: params.documentNumber,
      reasonCode: effectiveReasonCode,
      performedBy: params.performedBy,
      approvedBy: effectiveApprovedBy,
      sequenceNo: sequenceNo.toString(),
      createdAt: createdAt.toISOString(),
      prevHash,
    });

    const ledger = await tx.stockLedger.create({
      data: {
        branchId: params.branchId,
        productVariantId: params.productVariantId,
        warehouseLocationId: params.warehouseLocationId,
        batchId,
        quantityDeltaBase: params.quantityDeltaBase,
        movementType: params.movementType,
        unitCostAtMovement: params.unitCostAtMovement,
        conversionRateVersionId: params.conversionRateVersionId ?? null,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        documentNumber: params.documentNumber,
        reasonCode: effectiveReasonCode,
        performedBy: params.performedBy,
        approvedBy: effectiveApprovedBy,
        idempotencyKeyId: claim.id,
        createdAt,
        sequenceNo,
        prevHash,
        rowHash,
      },
      select: { id: true, sequenceNo: true, prevHash: true, rowHash: true },
    });

    await tx.stockBalance.upsert({
      where: {
        productVariantId_warehouseLocationId_batchId: {
          productVariantId: params.productVariantId,
          warehouseLocationId: params.warehouseLocationId,
          batchId,
        },
      },
      create: {
        productVariantId: params.productVariantId,
        warehouseLocationId: params.warehouseLocationId,
        batchId,
        quantityOnHand: params.quantityDeltaBase,
      },
      update: {
        quantityOnHand: { increment: params.quantityDeltaBase },
      },
    });

    await tx.idempotencyKey.update({
      where: { id: claim.id },
      data: { status: "COMPLETED", completedAt: new Date(), resultRef: ledger.id.toString() },
    });

    if (usingNegativeStockOverride) {
      await tx.auditLog.create({
        data: {
          actorId: params.allowNegativeStockOverride!.approvedBy,
          action: "ledger.negative_stock_override",
          entityType: "StockLedger",
          entityId: ledger.id.toString(),
          afterState: {
            reason: params.allowNegativeStockOverride!.reason,
            quantityDeltaBase: params.quantityDeltaBase.toString(),
            movementType: params.movementType,
            referenceType: params.referenceType,
            referenceId: params.referenceId,
          },
        },
      });
    }

    return { noop: false, ledger };
  }
}

interface IdempotencyClaim {
  id: string;
  alreadyCompleted: boolean;
}

/**
 * Race-safe claim via INSERT ... ON CONFLICT DO NOTHING — deliberately raw
 * SQL rather than Prisma's typed create(). A caught unique-constraint
 * exception from create() would abort the enclosing Postgres transaction
 * (Postgres aborts the whole transaction on any statement error until
 * rollback), which would make every subsequent query in this same
 * interactive transaction fail. ON CONFLICT DO NOTHING never raises, so
 * the transaction stays healthy either way.
 */
async function claimIdempotencyKey(
  tx: Prisma.TransactionClient,
  idem: PostLedgerEntryParams["idempotency"],
): Promise<IdempotencyClaim> {
  const candidateId = randomUUID();
  const inserted = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO idempotency_key (id, document_type, document_number, branch_code, request_payload_hash, status)
    VALUES (${candidateId}, ${idem.documentType}, ${idem.documentNumber}, ${idem.branchCode}, ${idem.requestPayloadHash}, 'IN_PROGRESS')
    ON CONFLICT (document_type, document_number, branch_code) DO NOTHING
    RETURNING id
  `;
  if (inserted.length > 0) {
    return { id: candidateId, alreadyCompleted: false };
  }

  // Lost the race (or a prior attempt already used this key) — inspect it.
  const existingRows = await tx.$queryRaw<
    { id: string; status: "IN_PROGRESS" | "COMPLETED" | "FAILED"; request_payload_hash: string }[]
  >`
    SELECT id, status, request_payload_hash FROM idempotency_key
    WHERE document_type = ${idem.documentType} AND document_number = ${idem.documentNumber} AND branch_code = ${idem.branchCode}
  `;
  const existing = existingRows[0];
  if (!existing) {
    throw new Error("idempotency_key row vanished between conflict and lookup — this should be unreachable.");
  }

  if (existing.request_payload_hash !== idem.requestPayloadHash) {
    throw new IdempotencyPayloadMismatchError(
      `A different request already used document number ${idem.documentNumber} (${idem.documentType}/${idem.branchCode}). This is a duplicate submission, not a legitimate retry.`,
    );
  }
  if (existing.status === "IN_PROGRESS") {
    throw new IdempotencyInProgressError(
      `Another request for ${idem.documentNumber} is currently being processed — try again shortly.`,
    );
  }
  if (existing.status === "FAILED") {
    // A prior attempt with this exact key rolled back before completing —
    // safe to retry under the same key.
    await tx.idempotencyKey.update({ where: { id: existing.id }, data: { status: "IN_PROGRESS" } });
    return { id: existing.id, alreadyCompleted: false };
  }
  return { id: existing.id, alreadyCompleted: true };
}
