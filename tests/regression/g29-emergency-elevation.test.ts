// G-29 — "Emergency" role-collapsing normalizes a segregation-of-duties
// bypass with no real-time gate.
// SYSTEM RULE: only the Owner may grant an emergency elevation; it has a
// hard end-of-day (Manila) expiry with no renew/extend function anywhere.
// DETECTION: assertPermission flags any grant used ONLY via an active
// elevation (viaElevation:true), and the exception report surfaces the
// day's elevations — both real; no dedicated monthly-frequency-per-branch
// trend report exists, but that's a lesser gap than a missing signal
// entirely, so not marked [GAP] on its own.
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { grantEmergencyElevation, NotAuthorizedToGrantElevationError } from "../../src/server/domain/session/emergencyElevation";
import { assertPermission } from "../../src/server/domain/rbac/assertPermission";
import { endOfDayManila } from "../../src/server/domain/time/businessDate";
import { getIloBranch, getUserByRole } from "./helpers/receiving";

const prisma = new PrismaClient();
const createdElevationIds: string[] = [];

describe("G-29: emergency elevation", () => {
  it("[rule] a non-Owner cannot grant an emergency elevation, even for themself", async () => {
    const branch = await getIloBranch(prisma);
    const supervisor = await getUserByRole(prisma, "warehouse_supervisor");
    const receiver = await getUserByRole(prisma, "warehouse_receiver");

    await expect(
      grantEmergencyElevation(prisma, {
        branchId: branch.id,
        grantedTo: receiver.id,
        grantedByUserId: supervisor.id,
        grantedByRole: "WAREHOUSE_SUPERVISOR",
        fromRole: "WAREHOUSE_RECEIVER",
        toRole: "WAREHOUSE_SUPERVISOR",
        reason: "self-declared emergency collapse attempt",
      }),
    ).rejects.toThrow(NotAuthorizedToGrantElevationError);
  });

  it("[rule] the Owner can grant one, and it expires at end-of-day Manila with no renew path in this module", async () => {
    const branch = await getIloBranch(prisma);
    const owner = await getUserByRole(prisma, "owner");
    const receiver = await getUserByRole(prisma, "warehouse_receiver");

    const before = new Date();
    const elevation = await grantEmergencyElevation(prisma, {
      branchId: branch.id,
      grantedTo: receiver.id,
      grantedByUserId: owner.id,
      grantedByRole: "OWNER",
      fromRole: "WAREHOUSE_RECEIVER",
      toRole: "WAREHOUSE_SUPERVISOR",
      reason: "supervisor out sick, genuine staffing shortage",
    });
    createdElevationIds.push(elevation.id);

    expect(elevation.expiresAt.getTime()).toBe(endOfDayManila(before).getTime());
    // No update/extend function exists anywhere in emergencyElevation.ts —
    // structurally confirmed by the module's exports themselves.
    const moduleExports = await import("../../src/server/domain/session/emergencyElevation");
    expect(Object.keys(moduleExports)).not.toContain("extendEmergencyElevation");
    expect(Object.keys(moduleExports)).not.toContain("renewEmergencyElevation");
    expect(Object.keys(moduleExports)).not.toContain("updateEmergencyElevation");
  });

  it("[detect] assertPermission flags a grant as viaElevation when the base role lacks the permission but the elevated role has it", async () => {
    const result = await assertPermission(prisma, {
      role: "WAREHOUSE_RECEIVER", // has no receiving.approve.create grant
      action: "receiving.approve.create",
      elevatedRole: "BRANCH_MANAGER", // does have it
    });
    expect(result.viaElevation).toBe(true);
  });
});

afterAll(async () => {
  await prisma.emergencyElevation.deleteMany({ where: { id: { in: createdElevationIds } } });
  await prisma.$disconnect();
});
