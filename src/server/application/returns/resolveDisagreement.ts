import type { PrismaClient, ReturnGrade, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import { ReturnAuthorizationNotFoundError } from "./receive";

export class ReturnNotDisputedError extends Error {}

export interface ResolveGradingDisagreementParams {
  actorUserId: string;
  actorRole: RoleName;
  raId: string;
  finalGrade: ReturnGrade;
}

/** RA-7. Branch Manager only, reachable only while status is GRADING_DISPUTED. */
export async function resolveGradingDisagreement(prisma: PrismaClient, params: ResolveGradingDisagreementParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "returns.grade.resolve-dispute.create" });

  const ra = await prisma.returnAuthorization.findUnique({ where: { id: params.raId } });
  if (!ra) throw new ReturnAuthorizationNotFoundError(params.raId);
  if (ra.status !== "GRADING_DISPUTED") {
    throw new ReturnNotDisputedError(`Cannot resolve a grading dispute for an RA that is ${ra.status} — it must be GRADING_DISPUTED.`);
  }

  return prisma.returnAuthorization.update({
    where: { id: ra.id },
    data: {
      status: "GRADED",
      finalGrade: params.finalGrade,
      finalGradeDecidedBy: params.actorUserId,
      finalGradeDecidedAt: new Date(),
    },
  });
}
