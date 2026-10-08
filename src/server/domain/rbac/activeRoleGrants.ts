import type { PermissionEffect, Prisma, PrismaClient, RoleName } from "@prisma/client";
import { EXTRA_ACTIONS, PERFORMS_AS } from "../../../lib/roleModel";

type Db = Prisma.TransactionClient | PrismaClient;

export interface Grant {
  role: RoleName;
  action: string;
  effect: PermissionEffect;
}

const EFFECT_RANK: Record<PermissionEffect, number> = { NONE: -1, VIEW: 0, CREATE: 1, APPROVE: 2 };

/**
 * Pure: the SECRETARY/ENCODER/OWNER grants implied by an existing
 * permission matrix (src/lib/roleModel.ts). Secretary and Encoder inherit
 * every row of the roles they now perform as, plus EXTRA_ACTIONS; Owner
 * gets every action anyone holds, at its strongest granted effect. Derived
 * rather than hand-listed so the three roles can never drift from the matrix.
 */
export function deriveActiveRoleGrants(base: readonly Grant[]): Grant[] {
  const granted = base.filter((g) => g.effect !== "NONE");

  const strongestByAction = new Map<string, PermissionEffect>();
  for (const g of granted) {
    const current = strongestByAction.get(g.action);
    if (!current || EFFECT_RANK[g.effect] > EFFECT_RANK[current]) strongestByAction.set(g.action, g.effect);
  }

  const derived = new Map<string, Grant>();
  const put = (role: RoleName, action: string, effect: PermissionEffect) => {
    const key = `${role}|${action}`;
    const previous = derived.get(key);
    if (!previous || EFFECT_RANK[effect] > EFFECT_RANK[previous.effect]) derived.set(key, { role, action, effect });
  };

  for (const [role, originalRoles] of Object.entries(PERFORMS_AS)) {
    for (const g of granted) {
      if (originalRoles.includes(g.role)) put(role as RoleName, g.action, g.effect);
    }
  }
  for (const [role, actions] of Object.entries(EXTRA_ACTIONS)) {
    for (const action of actions) {
      const effect = strongestByAction.get(action);
      if (effect) put(role as RoleName, action, effect);
    }
  }
  for (const [action, effect] of strongestByAction) put("OWNER", action, effect);

  return [...derived.values()];
}

/** Writes the derived three-role grants on top of the RolePermission rows already in the database. Idempotent; returns how many rows it created or changed. */
export async function syncActiveRoleGrants(db: Db): Promise<{ created: number; updated: number }> {
  const existing = await db.rolePermission.findMany({ select: { role: true, action: true, effect: true } });
  const existingByKey = new Map(existing.map((g) => [`${g.role}|${g.action}`, g.effect]));

  const toCreate: Grant[] = [];
  const toUpdate: Grant[] = [];
  for (const grant of deriveActiveRoleGrants(existing)) {
    const current = existingByKey.get(`${grant.role}|${grant.action}`);
    if (current === undefined) toCreate.push(grant);
    else if (EFFECT_RANK[grant.effect] > EFFECT_RANK[current]) toUpdate.push(grant);
  }

  if (toCreate.length > 0) await db.rolePermission.createMany({ data: toCreate, skipDuplicates: true });
  for (const g of toUpdate) {
    await db.rolePermission.update({ where: { role_action: { role: g.role, action: g.action } }, data: { effect: g.effect } });
  }
  return { created: toCreate.length, updated: toUpdate.length };
}
