import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

export interface LogGateEntryParams {
  actorUserId: string;
  actorRole: RoleName;
  branchId: string;
  direction: "IN" | "OUT";
  referenceType?: string;
  referenceId?: string;
  vehiclePlate?: string;
  driverName?: string;
}

/** Step 1 — gate & document check. Every vehicle/goods movement passes through here, both ways. */
export async function logGateEntry(prisma: PrismaClient, params: LogGateEntryParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "receiving.gate.log-in" });

  return prisma.gateLogEntry.create({
    data: {
      branchId: params.branchId,
      direction: params.direction,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      vehiclePlate: params.vehiclePlate,
      driverName: params.driverName,
      loggedBy: params.actorUserId,
    },
  });
}
