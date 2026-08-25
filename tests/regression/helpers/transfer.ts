// Shared fixtures/pipeline-driver for the Inter-Branch Transfer lifecycle
// (G-35). Not a finding itself.
import type { PrismaClient, RoleName } from "@prisma/client";
import { requestInterBranchTransfer } from "../../../src/server/application/transfer/request";
import { approveInterBranchTransferSending } from "../../../src/server/application/transfer/approveSending";
import { recordTransferPick } from "../../../src/server/application/transfer/pick";
import { recordTransferCheck } from "../../../src/server/application/transfer/check";
import { dispatchInterBranchTransfer } from "../../../src/server/application/transfer/dispatch";
import { recordTransferReceive, recordTransferReceiveCheck } from "../../../src/server/application/transfer/receiveCount";
import { getUserByRole, createSessionAndPin } from "./receiving";

/** REQUESTED -> SENDING_APPROVED, letting the caller pick the approver role (value-tiered — see G-35's own tests). */
export async function requestAndApproveSending(
  prisma: PrismaClient,
  params: { fromBranchId: string; toBranchId: string; variantId: string; requestedQty: number; requesterRole: RoleName; requesterUsername: string; approverUsername: string; approverRole: RoleName },
) {
  const requester = await getUserByRole(prisma, params.requesterUsername);
  const approver = await getUserByRole(prisma, params.approverUsername);

  const transfer = await requestInterBranchTransfer(prisma, {
    actorUserId: requester.id,
    actorRole: params.requesterRole,
    fromBranchId: params.fromBranchId,
    toBranchId: params.toBranchId,
    productVariantId: params.variantId,
    requestedQty: params.requestedQty,
  });

  const { session, pinToken } = await createSessionAndPin(prisma, approver.id);
  return approveInterBranchTransferSending(prisma, {
    actorUserId: approver.id,
    actorRole: params.approverRole,
    transferId: transfer.id,
    session,
    pinTokenId: pinToken.id,
  });
}

/** SENDING_APPROVED -> ARRIVED_PENDING_COUNT with a MATCHED receive-check (receivedQty === checkedQty === pickedQty), leaving the transfer ready for postReceiveInterBranchTransfer. */
export async function driveTransferToArrived(prisma: PrismaClient, params: { transferId: string; qty: number }) {
  const picker = await getUserByRole(prisma, "warehouse_picker");
  const checker = await getUserByRole(prisma, "warehouse_checker");
  const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
  const receiver = await getUserByRole(prisma, "warehouse_receiver");

  await recordTransferPick(prisma, { actorUserId: picker.id, actorRole: "WAREHOUSE_PICKER", transferId: params.transferId, pickedQty: params.qty });
  await recordTransferCheck(prisma, { actorUserId: checker.id, actorRole: "WAREHOUSE_CHECKER", transferId: params.transferId, checkedQty: params.qty });

  const { session, pinToken } = await createSessionAndPin(prisma, supervisor.id);
  await dispatchInterBranchTransfer(prisma, { actorUserId: supervisor.id, actorRole: "WAREHOUSE_SUPERVISOR", transferId: params.transferId, session, pinTokenId: pinToken.id });

  await recordTransferReceive(prisma, { actorUserId: receiver.id, actorRole: "WAREHOUSE_RECEIVER", transferId: params.transferId, countedQty: params.qty });
  return recordTransferReceiveCheck(prisma, { actorUserId: checker.id, actorRole: "WAREHOUSE_CHECKER", transferId: params.transferId, countedQty: params.qty });
}
