import type { Prisma, PrismaClient, RoleName } from "@prisma/client";
import { endOfDayManila } from "../time/businessDate";

type Db = Prisma.TransactionClient | PrismaClient;

/** Only the Owner may grant an emergency role-collapse elevation — never self-declared by anyone else. */
export class NotAuthorizedToGrantElevationError extends Error {}

export interface GrantEmergencyElevationParams {
  branchId: string;
  grantedTo: string;
  grantedByUserId: string;
  grantedByRole: RoleName;
  fromRole: RoleName;
  toRole: RoleName;
  reason: string;
}

/**
 * Grants a time-boxed emergency elevation (G-29). Hard end-of-day expiry
 * (Asia/Manila) — there is deliberately no update/renew function anywhere
 * in this module, so an elevation cannot be extended past its original
 * grant without the Owner creating a brand-new one (and thus a fresh
 * audit trail entry).
 *
 * Callers are responsible for having already required a fresh PIN token
 * from the Owner before invoking this — granting elevated power is itself
 * a sensitive action, not exempt from G-30.
 */
export async function grantEmergencyElevation(db: Db, params: GrantEmergencyElevationParams) {
  if (params.grantedByRole !== "OWNER") {
    throw new NotAuthorizedToGrantElevationError("Only the Owner may grant an emergency elevation.");
  }

  return db.emergencyElevation.create({
    data: {
      branchId: params.branchId,
      grantedTo: params.grantedTo,
      grantedBy: params.grantedByUserId,
      fromRole: params.fromRole,
      toRole: params.toRole,
      reason: params.reason,
      expiresAt: endOfDayManila(),
    },
  });
}

/** The active elevation for a user, if any — null if none, expired, or revoked. */
export async function getActiveElevation(db: Db, userId: string) {
  return db.emergencyElevation.findFirst({
    where: { grantedTo: userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { grantedAt: "desc" },
  });
}
