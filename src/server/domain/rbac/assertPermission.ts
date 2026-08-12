import type { Prisma, PrismaClient, RoleName } from "@prisma/client";

type Db = Prisma.TransactionClient | PrismaClient;

/** Fails closed: no matching row, or an explicit NONE row, both deny. */
export class PermissionDeniedError extends Error {}

export interface AssertPermissionParams {
  role: RoleName;
  action: string;
  /** The user's currently-active EmergencyElevation.toRole, if any (see getActiveElevation). */
  elevatedRole?: RoleName | null;
}

export interface AssertPermissionResult {
  effect: "CREATE" | "APPROVE" | "VIEW";
  /** true if permission was only granted through an active emergency elevation — callers must auto-flag the action for review. */
  viaElevation: boolean;
}

/**
 * The single shared RBAC check every API route must call — this is the
 * server-side enforcement of the permission matrix (business-process-
 * design.md sec.4.2). Never rely on a route being hidden in the UI; a
 * route that skips this call defeats the whole control.
 *
 * Fails closed: no RolePermission row, or an explicit NONE effect, both
 * deny. The base role is checked first; an active emergency elevation
 * (G-29) is only consulted if the base role doesn't already have it, and
 * the result is flagged so the caller can auto-log the elevated action.
 */
export async function assertPermission(db: Db, params: AssertPermissionParams): Promise<AssertPermissionResult> {
  const baseGrant = await db.rolePermission.findUnique({
    where: { role_action: { role: params.role, action: params.action } },
  });
  if (baseGrant && baseGrant.effect !== "NONE") {
    return { effect: baseGrant.effect, viaElevation: false };
  }

  if (params.elevatedRole) {
    const elevatedGrant = await db.rolePermission.findUnique({
      where: { role_action: { role: params.elevatedRole, action: params.action } },
    });
    if (elevatedGrant && elevatedGrant.effect !== "NONE") {
      return { effect: elevatedGrant.effect, viaElevation: true };
    }
  }

  throw new PermissionDeniedError(`Role ${params.role} is not permitted to perform "${params.action}".`);
}
