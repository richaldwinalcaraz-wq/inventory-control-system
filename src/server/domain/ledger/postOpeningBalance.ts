import type { PrismaClient } from "@prisma/client";
import { postLedgerEntry, type PostLedgerEntryParams, type PostLedgerEntryResult } from "./postLedgerEntry";

export class OpeningBalanceLockedError extends Error {}
/** BR-064: Opening Balance is allowed once per product per branch, ever — never repeatable. */
export class OpeningBalanceAlreadyPostedError extends Error {}

export interface PostOpeningBalanceParams {
  idempotency: PostLedgerEntryParams["idempotency"];
  branchId: string;
  productVariantId: string;
  warehouseLocationId: string;
  batchId?: string;
  quantityDeltaBase: number | string;
  unitCostAtMovement: number | string;
  /** Reference to the Owner-signed Opening Balance Count Sheet (BR-064). */
  referenceId: string;
  documentNumber: string;
  performedBy: string;
  /** BR-064 requires this to be Owner-signed — callers must have already verified approvedBy is the Owner. */
  approvedBy: string;
}

export async function postOpeningBalance(
  prismaClient: PrismaClient,
  params: PostOpeningBalanceParams,
): Promise<PostLedgerEntryResult> {
  // Opening Balance posting is locked until each branch's Phase 5 go-live
  // cutover — the plan deliberately builds this transaction type in Phase 1
  // (it's trivial once the ledger core exists) but leaves it unrouted in
  // the UI. This flag is the actual enforcement: even a direct call to
  // this function is refused unless it's explicitly turned on as part of
  // a cutover procedure, so "no UI button" is backed by a real gate, not
  // just an absent route. Read fresh on every call (not cached at module
  // load) so it reflects the deploy-time environment, not import order.
  if (process.env.OPENING_BALANCE_ENABLED !== "true") {
    throw new OpeningBalanceLockedError(
      "Opening Balance posting is locked until this branch's Phase 5 go-live cutover. Set OPENING_BALANCE_ENABLED=true only as part of that cutover procedure.",
    );
  }

  // Friendly early rejection — the partial unique index on stock_ledger
  // (migration 20260811131500) is the actual race-safe guarantee; this
  // pre-check just avoids making a well-behaved caller wait for a raw
  // constraint-violation error in the common case.
  const alreadyPosted = await prismaClient.stockLedger.findFirst({
    where: { branchId: params.branchId, productVariantId: params.productVariantId, movementType: "OPENING_BALANCE" },
  });
  if (alreadyPosted) {
    throw new OpeningBalanceAlreadyPostedError(
      `An Opening Balance has already been posted for product ${params.productVariantId} at branch ${params.branchId} (BR-064: allowed once per product per branch, ever).`,
    );
  }

  try {
    return await postLedgerEntry(prismaClient, {
      idempotency: params.idempotency,
      branchId: params.branchId,
      productVariantId: params.productVariantId,
      warehouseLocationId: params.warehouseLocationId,
      batchId: params.batchId,
      quantityDeltaBase: params.quantityDeltaBase,
      movementType: "OPENING_BALANCE",
      unitCostAtMovement: params.unitCostAtMovement,
      referenceType: "OpeningBalanceCountSheet",
      referenceId: params.referenceId,
      documentNumber: params.documentNumber,
      performedBy: params.performedBy,
      approvedBy: params.approvedBy,
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      throw new OpeningBalanceAlreadyPostedError(
        `An Opening Balance was posted for product ${params.productVariantId} at branch ${params.branchId} by a concurrent request (BR-064: allowed once per product per branch, ever).`,
      );
    }
    throw err;
  }
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2002";
}
