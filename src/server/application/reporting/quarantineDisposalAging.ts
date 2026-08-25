import type { PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";

/**
 * G-09 report, extracted from the quarantine-disposal-aging page (Phase 3)
 * so the same query is reusable by the Phase 4 uniform export endpoint
 * instead of being duplicated — behavior is identical to what the page
 * computed inline before this extraction.
 */
export async function getQuarantineDisposalAgingReport(prisma: PrismaClient, params: { actorRole: RoleName }) {
  await assertPermission(prisma, { role: params.actorRole, action: "reporting.quarantine-disposal-aging.view" });

  const [reports, certificates] = await Promise.all([
    prisma.damageReport.findMany({
      where: { status: { notIn: ["DISPOSED", "CLOSED"] } },
      orderBy: { quarantineEnteredAt: "asc" },
      select: {
        id: true,
        quarantineEnteredAt: true,
        quantity: true,
        status: true,
        productVariant: { select: { sku: true } },
        branch: { select: { name: true } },
      },
    }),
    prisma.disposalCertificate.findMany({
      where: { status: "FOR_DISPOSAL", forDisposalEnteredAt: { not: null } },
      orderBy: { forDisposalEnteredAt: "asc" },
      select: {
        id: true,
        forDisposalEnteredAt: true,
        disposition: true,
        quantity: true,
        damageReport: { select: { productVariant: { select: { sku: true } }, branch: { select: { name: true } } } },
      },
    }),
  ]);

  return { reports, certificates };
}
