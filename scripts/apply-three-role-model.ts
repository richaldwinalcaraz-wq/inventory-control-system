// One-off rollout of the three-role model (src/lib/roleModel.ts) to an
// already-seeded database. Idempotent — safe to re-run. Run with
// --dry-run first to see exactly what it would change.
//
//   1. Adds the catalog, price and pack-size permissions and derives the
//      SECRETARY/ENCODER/OWNER grants from the existing permission matrix.
//   2. Creates a "secretary" account if none exists (password + PIN printed once).
//   3. Deactivates every active account whose role is not OWNER/ENCODER/
//      SECRETARY (never deletes — their names stay on past documents) and
//      revokes their open sessions.
import { randomBytes, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import type { RoleName } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { ACTIVE_ROLES } from "../src/lib/roleModel";
import { syncActiveRoleGrants } from "../src/server/domain/rbac/activeRoleGrants";

const DRY_RUN = process.argv.includes("--dry-run");
const ACTIVE = new Set<string>(ACTIVE_ROLES);

async function main() {
  const owner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER", status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  const toDeactivate = await prisma.user.findMany({
    where: { status: "ACTIVE", role: { notIn: [...ACTIVE] as RoleName[] } },
    select: { id: true, username: true, role: true },
    orderBy: { username: "asc" },
  });
  const existingSecretary = await prisma.user.findFirst({ where: { role: "SECRETARY" } });

  console.log(`Owner of record: ${owner.username}`);
  console.log(`Accounts to deactivate (${toDeactivate.length}): ${toDeactivate.map((u) => `${u.username} [${u.role}]`).join(", ") || "none"}`);
  console.log(`Secretary account: ${existingSecretary ? `exists (${existingSecretary.username})` : "will be created as \"secretary\""}`);

  if (DRY_RUN) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  // Actions added after the original seed: the product/variant catalog, prices,
  // and pack-size checks (Secretary + Encoder confirm on first delivery).
  const added: Array<[RoleName, string]> = [
    ["OWNER", "inventory.product.update"],
    ["OWNER", "inventory.product.archive"],
    ["OWNER", "inventory.price.update"],
    ["OWNER", "inventory.pack_size.verify"],
    ["ENCODER", "inventory.pack_size.verify"],
    ["SECRETARY", "inventory.pack_size.verify"],
  ];
  for (const [role, action] of added) {
    await prisma.rolePermission.upsert({
      where: { role_action: { role, action } },
      update: {},
      create: { role, action, effect: "CREATE" },
    });
  }
  const grants = await syncActiveRoleGrants(prisma);
  console.log(`\nPermissions: ${grants.created} created, ${grants.updated} upgraded.`);

  let secretaryCredentials: { username: string; password: string; pin: string } | null = null;
  if (!existingSecretary) {
    const password = randomBytes(18).toString("base64url");
    const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await prisma.user.create({
      data: {
        username: "secretary",
        fullName: "Secretary",
        role: "SECRETARY",
        branchId: owner.branchId,
        passwordHash: await bcrypt.hash(password, 12),
        pinHash: await bcrypt.hash(pin, 12),
        status: "ACTIVE",
      },
    });
    secretaryCredentials = { username: "secretary", password, pin };
  }

  const now = new Date();
  for (const user of toDeactivate) {
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { status: "DEACTIVATED", deactivatedAt: now, deactivatedBy: owner.id } }),
      prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } }),
      prisma.auditLog.create({
        data: {
          actorId: owner.id,
          action: "user.deactivated",
          entityType: "User",
          entityId: user.id,
          beforeState: { status: "ACTIVE", role: user.role },
          afterState: { status: "DEACTIVATED", reason: "Three-role model: only OWNER, ENCODER, SECRETARY remain active." },
        },
      }),
    ]);
  }
  console.log(`Deactivated ${toDeactivate.length} account(s) and revoked their sessions.`);

  if (secretaryCredentials) {
    console.log("\nNew Secretary login. Save it now, it will not be shown again:");
    console.table([secretaryCredentials]);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
