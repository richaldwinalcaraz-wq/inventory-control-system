// Three-role operating model (client decision, 2026-10-05). The other
// RoleName enum values stay in the schema only so historical documents
// keep resolving their actors' roles — no active account holds them.
// Pure module (no server imports) so client action panels, the server
// domain layer, and the seed all read the same single definition.

export const ACTIVE_ROLES = ["OWNER", "ENCODER", "SECRETARY"] as const;
export type ActiveRole = (typeof ACTIVE_ROLES)[number];

/** Which original workflow roles each active role now performs. OWNER is omitted — it performs all of them. */
export const PERFORMS_AS: Readonly<Record<string, readonly string[]>> = {
  SECRETARY: ["WAREHOUSE_RECEIVER"],
  ENCODER: ["ENCODER", "WAREHOUSE_CHECKER"],
};

/** Individual actions granted on top of PERFORMS_AS (a slice of a role, not the whole role). */
export const EXTRA_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  ENCODER: ["receiving.verify.create"],
};

/** The Owner is the superuser: every action, any approval tier, and exempt from the "different person" (SoD) rules — every action still records their name in the ledger/audit trail. */
export function isOwner(role: string): boolean {
  return role === "OWNER";
}

/** True if `role` may act in any of the given original workflow roles' slots. Always true for the Owner. */
export function actsAs(role: string, ...originalRoles: string[]): boolean {
  if (isOwner(role) || originalRoles.includes(role)) return true;
  return (PERFORMS_AS[role] ?? []).some((r) => originalRoles.includes(r));
}

/** Approval-tier check: the exact role the threshold requires, or the Owner. */
export function satisfiesApproverTier(actorRole: string, requiredRole: string): boolean {
  return actorRole === requiredRole || isOwner(actorRole);
}
