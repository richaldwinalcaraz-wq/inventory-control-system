import { createHash } from "node:crypto";
import type { PrismaClient, RoleName, Session } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { requirePostingAuthorization } from "../../domain/session/postingAuthorization";
import { validatePostingDate } from "../../domain/period/validatePostingDate";
import { issueDocumentNumber } from "../../domain/documents/documentNumber";
import { postLedgerEntryInTx } from "../../domain/ledger/postLedgerEntry";
import { getCurrentUnitCost } from "../../domain/ledger/currentUnitCost";
import { releaseReservations } from "../../domain/wholesale/reservation";
import { SalesOrderReleaseNotFoundError, InvalidReleaseStateError } from "./gateCheck";

export class GateCheckPreconditionsNotMetError extends Error {}
export class NotReadyForReleasePostingError extends Error {}

export interface PostSalesOrderReleaseParams {
  actorUserId: string;
  actorRole: RoleName;
  releaseId: string;
  branchCode: string;
  session: Pick<Session, "id" | "userId" | "lastActiveAt">;
  pinTokenId: string;
  postingDate?: Date;
  supervisorApproval?: { approvedBy: string; approvedByRole: RoleName };
}

/**
 * RELEASED -> POSTED. Asserts weightCheckPassed && sealVerifiedIntact
 * again here — a hard posting precondition, not merely something recorded
 * at the gate step, mirroring encodeReceivingReport's evidence-required
 * pattern. Posts SALE_OUT from the RELEASE zone (where createSalesOrder-
 * Release already staged the physical stock, giving this a real cost
 * basis) — the DR document number is only issued once every precondition
 * has cleared, so a blocked posting never burns a booklet number.
 */
export async function postSalesOrderRelease(prisma: PrismaClient, params: PostSalesOrderReleaseParams) {
  const release = await prisma.salesOrderRelease.findUnique({ where: { id: params.releaseId }, include: { lines: { include: { salesOrderLine: true } }, salesOrder: true } });
  if (!release) throw new SalesOrderReleaseNotFoundError(params.releaseId);
  if (release.status !== "RELEASED") {
    throw new InvalidReleaseStateError(`Cannot post a release that is ${release.status} — it must be RELEASED.`);
  }
  if (!release.weightCheckPassed || !release.sealVerifiedIntact) {
    throw new GateCheckPreconditionsNotMetError(
      `Release ${release.id} cannot be posted — the gate weight check and seal verification must both have passed.`,
    );
  }

  await assertPermission(prisma, { role: params.actorRole, action: "wholesale.release.post.create" });

  const postingDate = params.postingDate ?? new Date();
  await validatePostingDate(prisma, { branchId: release.salesOrder.branchId, postingDate, supervisorApproval: params.supervisorApproval });

  return prisma.$transaction(async (tx) => {
    const claim = await tx.salesOrderRelease.updateMany({ where: { id: release.id, status: "RELEASED" }, data: { status: "POSTED", releasedBy: params.actorUserId } });
    if (claim.count === 0) {
      throw new NotReadyForReleasePostingError(`Release ${release.id} is no longer RELEASED — it was likely already claimed by a concurrent post attempt.`);
    }

    await requirePostingAuthorization(tx, { session: params.session, pinTokenId: params.pinTokenId, action: `wholesale.release.post:${release.id}` });

    const docNumber = await issueDocumentNumber(tx, {
      branchId: release.salesOrder.branchId,
      branchCode: params.branchCode,
      documentType: "DR",
      referenceId: release.id,
    });

    const releaseLocation = await tx.warehouseLocation.findFirstOrThrow({ where: { zone: "RELEASE", warehouse: { branchId: release.salesOrder.branchId } } });

    const ledgerRows = [];
    for (const line of release.lines) {
      const unitCost = await getCurrentUnitCost(tx, { productVariantId: line.salesOrderLine.productVariantId, warehouseLocationId: releaseLocation.id });
      const requestPayload = { releaseId: release.id, salesOrderLineId: line.salesOrderLineId, qty: line.qty.toString() };
      const result = await postLedgerEntryInTx(tx, {
        idempotency: {
          documentType: "DR",
          documentNumber: `${docNumber.fullNumber}:${line.id}`,
          branchCode: params.branchCode,
          requestPayloadHash: createHash("sha256").update(JSON.stringify(requestPayload)).digest("hex"),
        },
        branchId: release.salesOrder.branchId,
        productVariantId: line.salesOrderLine.productVariantId,
        warehouseLocationId: releaseLocation.id,
        quantityDeltaBase: `-${line.qty.toString()}`,
        movementType: "SALE_OUT",
        unitCostAtMovement: unitCost,
        referenceType: "SalesOrderRelease",
        referenceId: release.id,
        documentNumber: docNumber.fullNumber,
        performedBy: params.actorUserId,
      });
      ledgerRows.push(result);
    }

    const posted = await tx.salesOrderRelease.update({ where: { id: release.id }, data: { documentNumberId: docNumber.id } });

    // Once every line on the order has been fully released (and this
    // posting is what finalizes physical departure), the order's
    // reservations have done their job and are cleared. Deliberately a
    // Phase 2 simplification, not per-partial-release proportional
    // decrementing — see release.ts's comment on why staying ACTIVE through
    // the partial-fulfillment window is the conservative, not the unsafe,
    // direction (ATP still correctly reflects staged-but-unposted stock via
    // stock_balance across the whole branch).
    const refreshedLines = await tx.salesOrderLine.findMany({ where: { salesOrderId: release.salesOrderId } });
    const fullyReleased = refreshedLines.every((l) => Number(l.releasedQty) >= Number(l.checkedQty ?? 0));
    if (fullyReleased) {
      await releaseReservations(tx, { referenceType: "SalesOrder", referenceId: release.salesOrderId, toStatus: "CONSUMED" });
    }

    return { release: posted, documentNumber: docNumber.fullNumber, ledgerRows };
  });
}
