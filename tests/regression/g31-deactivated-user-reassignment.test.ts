// G-31 — When staff leaves or is deactivated, their still-open discrepancy
// cases must not stay silently assigned to a person who can no longer act
// on them.
// SYSTEM RULE (narrow scope, per code comment): checkDeactivatedUserOpenItems
// reassigns every OPEN DiscrepancyCase currently assignedTo a DEACTIVATED
// user to that user's own branch's Branch Manager, falling back to the
// Owner if none is configured (covers both "they had no branch at all" and
// "they WERE the branch manager").
// DETECTION: this check itself is the detection mechanism — no separate
// gap test needed for the reassignment path itself.
// GAP (documented, not tested as a failing assertion — see the finding's
// own scope note): BR-085 is broader than this — pending APPROVALS and
// self-raised requests a deactivated user still holds are NOT covered by
// this function at all, only DiscrepancyCase.assignedTo. That's a design
// fact confirmed by reading the source, not something a runtime test can
// meaningfully assert against (there's no code path to call).
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { checkDeactivatedUserOpenItems } from "../../src/server/application/discrepancy/deactivatedUsers";
import { getIloBranch, getUserByRole, createEphemeralUser } from "./helpers/receiving";

const prisma = new PrismaClient();

describe("G-31: deactivated-user open-item reassignment", () => {
  it("[rule] a deactivated user's OPEN case is reassigned to their branch's Branch Manager", async () => {
    const branch = await getIloBranch(prisma);
    const auditor = await getUserByRole(prisma, "auditor");
    const branchManager = await getUserByRole(prisma, "branch_manager");
    const holder = await createEphemeralUser(prisma, { branchId: branch.id, role: "WAREHOUSE_SUPERVISOR", label: "g31-holder" });

    const openCase = await prisma.discrepancyCase.create({
      data: { referenceType: "RegressionTestG31", referenceId: `g31-${Date.now()}`, openedBy: auditor.id, assignedTo: holder.id },
    });

    await prisma.user.update({ where: { id: holder.id }, data: { status: "DEACTIVATED", deactivatedAt: new Date(), deactivatedBy: auditor.id } });

    const reassigned = await checkDeactivatedUserOpenItems(prisma, { actorUserId: auditor.id, actorRole: "AUDITOR" });
    const thisOne = reassigned.find((c) => c.id === openCase.id);
    expect(thisOne).toBeDefined();
    expect(thisOne?.assignedTo).toBe(branchManager.id);
  });

  it("[rule] a deactivated user with no branch at all (e.g. a deactivated Auditor) falls back to the Owner", async () => {
    const auditor = await getUserByRole(prisma, "auditor");
    const owner = await getUserByRole(prisma, "owner");
    const holder = await createEphemeralUser(prisma, { branchId: null, role: "AUDITOR", label: "g31-branchless-holder" });

    const openCase = await prisma.discrepancyCase.create({
      data: { referenceType: "RegressionTestG31", referenceId: `g31-branchless-${Date.now()}`, openedBy: auditor.id, assignedTo: holder.id },
    });

    await prisma.user.update({ where: { id: holder.id }, data: { status: "DEACTIVATED", deactivatedAt: new Date(), deactivatedBy: auditor.id } });

    const reassigned = await checkDeactivatedUserOpenItems(prisma, { actorUserId: auditor.id, actorRole: "AUDITOR" });
    const thisOne = reassigned.find((c) => c.id === openCase.id);
    expect(thisOne).toBeDefined();
    expect(thisOne?.assignedTo).toBe(owner.id);
  });

  it("[rule] a deactivated user with no OPEN cases at all is simply skipped — never appears in the reassignment result", async () => {
    const branch = await getIloBranch(prisma);
    const auditor = await getUserByRole(prisma, "auditor");
    const holder = await createEphemeralUser(prisma, { branchId: branch.id, role: "WAREHOUSE_CHECKER", label: "g31-empty-holder" });
    await prisma.user.update({ where: { id: holder.id }, data: { status: "DEACTIVATED", deactivatedAt: new Date(), deactivatedBy: auditor.id } });

    const reassigned = await checkDeactivatedUserOpenItems(prisma, { actorUserId: auditor.id, actorRole: "AUDITOR" });
    expect(reassigned.find((c) => c.assignedTo === holder.id)).toBeUndefined();
  });
});
