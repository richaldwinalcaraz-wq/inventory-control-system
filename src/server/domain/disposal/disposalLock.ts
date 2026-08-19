import type { Prisma } from "@prisma/client";

/**
 * Lazily-upserted-then-FOR-UPDATE mutex row, one per DamageReport — the
 * third concurrency fix (same class as StockReservationLock/
 * ReturnQuantityLock). Without it, two DisposalCertificates could be
 * created concurrently against the same report, each individually valid
 * (e.g. a 100-unit report, two staff simultaneously draft a 60-unit
 * DESTROY certificate and a 60-unit SELL_AS_SECONDS certificate — each
 * reads "60 <= 100 remaining" independently). Every certificate-creating
 * transaction must call this before computing remaining-undisposed qty and
 * inserting.
 */
export async function lockDamageReportDisposalRow(tx: Prisma.TransactionClient, params: { damageReportId: string }): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO damage_report_disposal_lock (damage_report_id) VALUES (${params.damageReportId})
    ON CONFLICT (damage_report_id) DO NOTHING
  `;
  await tx.$queryRaw`
    SELECT damage_report_id FROM damage_report_disposal_lock
    WHERE damage_report_id = ${params.damageReportId}
    FOR UPDATE
  `;
}

/**
 * remainingUndisposedQty = report.quantity − SUM(certificate.quantity
 * across every non-VOID DisposalCertificate against this report).
 * Caller must hold lockDamageReportDisposalRow first.
 */
export async function computeRemainingUndisposedQty(
  tx: Prisma.TransactionClient,
  params: { damageReportId: string; totalQty: number },
): Promise<number> {
  const rows = await tx.$queryRaw<{ sum: string | null }[]>`
    SELECT SUM(quantity)::text as sum FROM disposal_certificate
    WHERE damage_report_id = ${params.damageReportId} AND status != 'VOID'
  `;
  const alreadyCommitted = Number(rows[0]?.sum ?? 0);
  return params.totalQty - alreadyCommitted;
}

/**
 * postedQty = SUM(certificate.quantity across every POSTED DisposalCertificate
 * against this report). Deliberately a separate calculation from
 * computeRemainingUndisposedQty above, which counts DRAFT/FOR_DISPOSAL
 * certificates too — correct for THAT function's job (blocking a new
 * certificate from over-allocating against capacity that's already spoken
 * for, in-flight or not), but wrong for deciding whether a report is
 * actually, physically done. Use this one for "is it really finished,"
 * never the other — see finalize.ts.
 */
export async function computePostedDisposalQty(tx: Prisma.TransactionClient, params: { damageReportId: string }): Promise<number> {
  const rows = await tx.$queryRaw<{ sum: string | null }[]>`
    SELECT SUM(quantity)::text as sum FROM disposal_certificate
    WHERE damage_report_id = ${params.damageReportId} AND status = 'POSTED'
  `;
  return Number(rows[0]?.sum ?? 0);
}
