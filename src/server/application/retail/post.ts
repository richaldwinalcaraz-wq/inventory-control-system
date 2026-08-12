import { createHash } from "node:crypto";
import type { PrismaClient, RoleName, Session } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { requirePostingAuthorization } from "../../domain/session/postingAuthorization";
import { issueDocumentNumber } from "../../domain/documents/documentNumber";
import { postLedgerEntryInTx } from "../../domain/ledger/postLedgerEntry";
import { getCurrentUnitCost } from "../../domain/ledger/currentUnitCost";
import { RetailSaleNotFoundError, InvalidRetailSaleStateError } from "./draft";

export interface PostRetailSaleParams {
  actorUserId: string;
  actorRole: RoleName;
  retailSaleId: string;
  branchCode: string;
  session: Pick<Session, "id" | "userId" | "lastActiveAt">;
  pinTokenId: string;
}

/**
 * Steps 4-6 as one atomic action (business-process-design.md sec.8.1):
 * payment collected, Sales Invoice/OR issued (a real booklet-controlled
 * document — "BIR-registered, pre-numbered"), goods handed over, stock
 * posted. No separate encoding step for retail, unlike Receiving — there's
 * no approval gate between these steps to justify splitting them into
 * distinct committed states, so this collapses into one transaction
 * exactly like encodeReceivingReport's pattern. A negative-stock rejection
 * here rolls back the document-number issuance too, so a blocked oversell
 * never burns an audited booklet number.
 */
export async function postRetailSale(prisma: PrismaClient, params: PostRetailSaleParams) {
  const sale = await prisma.retailSale.findUnique({ where: { id: params.retailSaleId }, include: { lines: true } });
  if (!sale) throw new RetailSaleNotFoundError(params.retailSaleId);
  if (sale.status !== "DRAFT") {
    throw new InvalidRetailSaleStateError(`Cannot post a retail sale that is ${sale.status} — it must be DRAFT.`);
  }

  await assertPermission(prisma, { role: params.actorRole, action: "retail.sale.post.create" });

  return prisma.$transaction(async (tx) => {
    const claim = await tx.retailSale.updateMany({ where: { id: sale.id, status: "DRAFT" }, data: { status: "POSTED" } });
    if (claim.count === 0) {
      throw new InvalidRetailSaleStateError(`Retail sale ${sale.id} is no longer DRAFT — it was likely already posted.`);
    }

    await requirePostingAuthorization(tx, {
      session: params.session,
      pinTokenId: params.pinTokenId,
      action: `retail.sale.post:${sale.id}`,
    });

    const docNumber = await issueDocumentNumber(tx, {
      branchId: sale.branchId,
      branchCode: params.branchCode,
      documentType: "SI",
      referenceId: sale.id,
    });

    const counterLocation = await tx.warehouseLocation.findFirstOrThrow({
      where: { zone: "COUNTER", warehouse: { branchId: sale.branchId } },
    });

    const ledgerRows = [];
    for (const line of sale.lines) {
      const unitCost = await getCurrentUnitCost(tx, { productVariantId: line.productVariantId, warehouseLocationId: counterLocation.id });
      const requestPayload = { saleId: sale.id, productVariantId: line.productVariantId, quantity: line.quantity.toString() };
      const result = await postLedgerEntryInTx(tx, {
        idempotency: {
          documentType: "SI",
          documentNumber: `${docNumber.fullNumber}:${line.id}`,
          branchCode: params.branchCode,
          requestPayloadHash: createHash("sha256").update(JSON.stringify(requestPayload)).digest("hex"),
        },
        branchId: sale.branchId,
        productVariantId: line.productVariantId,
        warehouseLocationId: counterLocation.id,
        quantityDeltaBase: `-${line.quantity.toString()}`,
        movementType: "SALE_OUT",
        unitCostAtMovement: unitCost,
        referenceType: "RetailSale",
        referenceId: sale.id,
        documentNumber: docNumber.fullNumber,
        performedBy: params.actorUserId,
      });
      ledgerRows.push(result);
    }

    const posted = await tx.retailSale.update({
      where: { id: sale.id },
      data: { documentNumberId: docNumber.id },
    });

    return { retailSale: posted, documentNumber: docNumber.fullNumber, ledgerRows };
  });
}
