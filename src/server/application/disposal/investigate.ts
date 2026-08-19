import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

export class DamageReportNotFoundError extends Error {}
export class InvalidDamageReportStateError extends Error {}

export interface RecordCauseInvestigationParams {
  actorUserId: string;
  actorRole: RoleName;
  damageReportId: string;
}

/** DR-2. REPORTED -> INVESTIGATED, by a Supervisor. */
export async function recordCauseInvestigation(prisma: PrismaClient, params: RecordCauseInvestigationParams) {
  await assertPermission(prisma, { role: params.actorRole, action: "disposal.report.investigate.create" });

  const claim = await prisma.damageReport.updateMany({
    where: { id: params.damageReportId, status: "REPORTED" },
    data: { status: "INVESTIGATED" },
  });
  if (claim.count === 0) {
    const report = await prisma.damageReport.findUnique({ where: { id: params.damageReportId } });
    if (!report) throw new DamageReportNotFoundError(params.damageReportId);
    throw new InvalidDamageReportStateError(`Cannot investigate a damage report that is ${report.status} — it must be REPORTED.`);
  }
  return prisma.damageReport.findUniqueOrThrow({ where: { id: params.damageReportId } });
}
