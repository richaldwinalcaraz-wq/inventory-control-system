import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { ReturnAuthorizationNotFoundError, InvalidReturnAuthorizationStateError } from "./receive";

export class ReturnCountAlreadySubmittedError extends Error {}
export class ReturnReceiveCountMissingError extends Error {}
export class ReturnCheckerMustNotBeReceiverError extends Error {}

export interface SubmitReturnReceiveCountParams {
  actorUserId: string;
  actorRole: RoleName;
  raId: string;
  countedQty: number;
}

/** First blind count on the physically-received goods, by the Receiver. */
export async function submitReturnReceiveCount(prisma: PrismaClient, params: SubmitReturnReceiveCountParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "returns.count.receive.create" });

  const ra = await prisma.returnAuthorization.findUnique({ where: { id: params.raId } });
  if (!ra) throw new ReturnAuthorizationNotFoundError(params.raId);
  if (ra.status !== "GOODS_RECEIVED") {
    throw new InvalidReturnAuthorizationStateError(`Cannot count an RA that is ${ra.status} — goods must be logged as received first.`);
  }

  const existing = await prisma.countSlip.findMany({ where: { referenceType: "ReturnAuthorization", referenceId: params.raId } });
  if (existing.some((s) => s.role === "RETURN_RECEIVE")) {
    throw new ReturnCountAlreadySubmittedError("A receiver count has already been submitted and is read-only.");
  }

  return prisma.countSlip.create({
    data: {
      referenceType: "ReturnAuthorization",
      referenceId: params.raId,
      role: "RETURN_RECEIVE",
      countedBy: params.actorUserId,
      lines: { create: [{ productVariantId: ra.productVariantId, countedQty: params.countedQty }] },
    },
    include: { lines: true },
  });
}

export interface SubmitReturnCheckCountParams {
  actorUserId: string;
  actorRole: RoleName;
  raId: string;
  countedQty: number;
}

export interface SubmitReturnCheckCountResult {
  countSlip: { id: string };
  matched: boolean;
}

/**
 * Second blind count, by the Checker — never reads back the Receiver's
 * figure to the caller, and the Checker cannot be the same person as the
 * Receiver (same SoD as Receiving's blind double-count).
 *
 * On a mismatch, this deliberately opens a DiscrepancyCase rather than
 * inventing a bespoke Returns tie-break role — the plan names only
 * RETURN_RECEIVE/RETURN_CHECK, so unlike Receiving's dedicated Supervisor
 * tie-break, disagreement here routes through the general investigation
 * workflow built in step 1.
 *
 * On a match, the counted quantity is capped at RA.requestedQty — any
 * excess is never silently folded into the accepted amount, it opens a
 * DiscrepancyCase for a Branch Manager decision (BPD: "excess held
 * pending Br. Manager decision").
 */
export async function submitReturnCheckCount(prisma: PrismaClient, params: SubmitReturnCheckCountParams): Promise<SubmitReturnCheckCountResult> {
  await assertPermission(prisma, { role: params.actorRole, action: "returns.count.check.create" });

  const ra = await prisma.returnAuthorization.findUnique({ where: { id: params.raId } });
  if (!ra) throw new ReturnAuthorizationNotFoundError(params.raId);
  if (ra.status !== "GOODS_RECEIVED") {
    throw new InvalidReturnAuthorizationStateError(`Cannot count an RA that is ${ra.status} — goods must be logged as received first.`);
  }

  const existing = await prisma.countSlip.findMany({
    where: { referenceType: "ReturnAuthorization", referenceId: params.raId },
    include: { lines: true },
  });
  const receiveSlip = existing.find((s) => s.role === "RETURN_RECEIVE");
  if (!receiveSlip) throw new ReturnReceiveCountMissingError("The receiver count must be submitted first.");
  if (receiveSlip.countedBy === params.actorUserId) {
    throw new ReturnCheckerMustNotBeReceiverError("The Checker must not be the same person as the Receiver.");
  }
  if (existing.some((s) => s.role === "RETURN_CHECK")) {
    throw new ReturnCountAlreadySubmittedError("A checker count has already been submitted and is read-only.");
  }

  const checkSlip = await prisma.countSlip.create({
    data: {
      referenceType: "ReturnAuthorization",
      referenceId: params.raId,
      role: "RETURN_CHECK",
      countedBy: params.actorUserId,
      lines: { create: [{ productVariantId: ra.productVariantId, countedQty: params.countedQty }] },
    },
    include: { lines: true },
  });

  const receiveQty = Number(receiveSlip.lines[0]?.countedQty ?? 0);
  const checkQty = Number(checkSlip.lines[0]?.countedQty ?? 0);
  const matched = receiveQty === checkQty;

  if (!matched) {
    await prisma.discrepancyCase.create({
      data: {
        referenceType: "ReturnAuthorization",
        referenceId: params.raId,
        openedBy: params.actorUserId,
        notes: `Return count mismatch: receiver counted ${receiveQty}, checker counted ${checkQty} — requires Branch Manager reconciliation before grading.`,
      },
    });
    return { countSlip: { id: checkSlip.id }, matched: false };
  }

  const requestedQty = Number(ra.requestedQty);
  if (checkQty > requestedQty) {
    const excess = checkQty - requestedQty;
    await prisma.discrepancyCase.create({
      data: {
        referenceType: "ReturnAuthorization",
        referenceId: params.raId,
        openedBy: params.actorUserId,
        notes: `Returned quantity (${checkQty}) exceeds the authorized RA quantity (${requestedQty}) by ${excess} — excess held pending Branch Manager decision, not silently accepted.`,
      },
    });
  }

  return { countSlip: { id: checkSlip.id }, matched: true };
}
