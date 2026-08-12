import { apiHandler } from "@/server/http/handler";
import { getCurrentActor } from "@/server/http/currentActor";
import { ReceivingReportNotFoundError } from "@/server/application/receiving/draft";
import { prisma } from "@/lib/prisma";

/**
 * Deliberately does NOT include CountSlip line quantities — only whether
 * each slip exists, who submitted it, and when. Exposing a slip's figures
 * here would defeat blind counting for anyone still about to submit the
 * other slip. finalQty is safe to show once set, since by then it's the
 * agreed/reconciled value, not one party's blind figure.
 */
export const GET = apiHandler<{ rrId: string }>(async (_request, { rrId }) => {
  await getCurrentActor();

  const rr = await prisma.receivingReport.findUnique({
    where: { id: rrId },
    include: {
      supplier: { select: { name: true, contactPhone: true } },
      documentNumber: { select: { fullNumber: true } },
      lines: {
        select: {
          id: true,
          productVariantId: true,
          expectedQty: true,
          finalQty: true,
          unitCost: true,
          lineStatus: true,
          productVariant: { select: { sku: true, product: { select: { name: true } } } },
        },
      },
    },
  });
  if (!rr) throw new ReceivingReportNotFoundError(rrId);

  const countSlips = await prisma.countSlip.findMany({
    where: { referenceType: "ReceivingReport", referenceId: rrId },
    select: { id: true, role: true, countedBy: true, witnessedBy: true, countedAt: true },
  });
  const hasReceiverSlip = countSlips.some((s) => s.role === "RECEIVER");
  const hasCheckerSlip = countSlips.some((s) => s.role === "CHECKER");
  const hasTieBreakSlip = countSlips.some((s) => s.role === "TIEBREAK");
  // A tie-break is needed exactly when both the first two counts exist but
  // the RR is still DRAFT — a match would already have auto-advanced it.
  // This never reveals the actual figures, only that they disagreed.
  const needsTieBreak = hasReceiverSlip && hasCheckerSlip && !hasTieBreakSlip && rr.status === "DRAFT";

  return { ...rr, countSlips, hasReceiverSlip, hasCheckerSlip, hasTieBreakSlip, needsTieBreak };
});
