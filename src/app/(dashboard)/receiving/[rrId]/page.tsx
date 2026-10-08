import { notFound, redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { ReceivingActionPanel } from "./ReceivingActionPanel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { RECEIVING_STATUS_TONE } from "../status";
import { Card } from "@/components/ui/Card";
import { PackSizeCheck } from "@/components/catalog/PackSizeCheck";

export default async function ReceivingDetailPage({ params }: { params: Promise<{ rrId: string }> }) {
  const { rrId } = await params;
  const session = await getAppSession();
  if (!session) redirect("/login");

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
          productVariant: { select: { sku: true, name: true, product: { select: { name: true, baseUnit: { select: { code: true } } } } } },
        },
      },
    },
  });
  if (!rr) notFound();

  const countSlips = await prisma.countSlip.findMany({
    where: { referenceType: "ReceivingReport", referenceId: rrId },
    select: { id: true, role: true, countedBy: true, witnessedBy: true, countedAt: true },
  });
  const hasReceiverSlip = countSlips.some((s) => s.role === "RECEIVER");
  const hasCheckerSlip = countSlips.some((s) => s.role === "CHECKER");
  const hasTieBreakSlip = countSlips.some((s) => s.role === "TIEBREAK");
  const needsTieBreak = hasReceiverSlip && hasCheckerSlip && !hasTieBreakSlip && rr.status === "DRAFT";

  const users = await prisma.user.findMany({
    where: { branchId: rr.branchId, status: "ACTIVE" },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, role: true },
  });

  // Pack sizes ("1 Sack = 40 RIM") still waiting for their two physical
  // checks, for the items on this delivery — the goods are in hand here.
  const pendingPackSizes =
    rr.status === "VOID"
      ? []
      : await prisma.conversionRateVersion.findMany({
          where: { productVariantId: { in: rr.lines.map((l) => l.productVariantId) }, status: "PENDING_VERIFICATION" },
          include: { fromUnit: { select: { name: true } }, toUnit: { select: { code: true } }, productVariant: { select: { sku: true, name: true, product: { select: { name: true } } } } },
          orderBy: { createdAt: "asc" },
        });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-slate-900">Receiving Report — {rr.drNumber}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          Supplier: {rr.supplier.name}
          <StatusBadge label={rr.status} tone={RECEIVING_STATUS_TONE[rr.status] ?? "neutral"} />
          {rr.documentNumber ? <>Document #: {rr.documentNumber.fullNumber}</> : null}
        </p>
      </div>

      <div className="mb-6 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2">Expected</th>
              <th className="px-3 py-2">Final</th>
              <th className="px-3 py-2">Unit cost</th>
              <th className="px-3 py-2">Line status</th>
            </tr>
          </thead>
          <tbody>
            {rr.lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{l.productVariant.sku}</td>
                <td className="px-3 py-2">
                  {l.productVariant.name ?? l.productVariant.product.name}
                  {l.productVariant.name ? <span className="block text-xs text-slate-500">{l.productVariant.product.name}</span> : null}
                </td>
                <td className="px-3 py-2">
                  {l.expectedQty?.toString() ?? "—"} {l.expectedQty ? <span className="text-xs text-slate-500">{l.productVariant.product.baseUnit.code}</span> : null}
                </td>
                <td className="px-3 py-2">
                  {l.finalQty?.toString() ?? "—"} {l.finalQty ? <span className="text-xs text-slate-500">{l.productVariant.product.baseUnit.code}</span> : null}
                </td>
                <td className="px-3 py-2">{l.unitCost.toString()}</td>
                <td className="px-3 py-2">{l.lineStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pendingPackSizes.length > 0 ? (
        <Card className="mb-6 border-amber-200 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Confirm pack sizes</h2>
          <p className="mb-3 text-xs text-slate-600">
            These sizes came from the price list and don&apos;t count until two people open one and count it. Whoever proposed a size can&apos;t check it.
          </p>
          <ul className="flex flex-col divide-y divide-slate-100">
            {pendingPackSizes.map((p) => {
              const canCheck = p.proposedBy !== session.user.id && p.verifiedByUser1 !== session.user.id;
              return (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="text-sm">
                    <p className="font-medium text-slate-900">{p.productVariant.name ?? p.productVariant.product.name}</p>
                    <p className="text-slate-600">
                      1 {p.fromUnit.name} = {Number(p.rate)} {p.toUnit.code}? <span className="text-xs text-slate-500">({p.verifiedByUser1 ? "1" : "0"} of 2 checks)</span>
                    </p>
                  </div>
                  {canCheck ? (
                    <PackSizeCheck conversionRateVersionId={p.id} unitName={p.fromUnit.name} baseUnitCode={p.toUnit.code} rate={Number(p.rate)} checksDone={p.verifiedByUser1 ? 1 : 0} />
                  ) : (
                    <span className="text-xs text-slate-500">{p.proposedBy === session.user.id ? "You proposed this size, so someone else must check it." : "You already checked this. A second person must confirm it."}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <ReceivingActionPanel
        rr={{
          id: rr.id,
          status: rr.status,
          receivedBy: rr.receivedBy,
          poReference: rr.poReference,
          supplierCallbackConfirmedAt: rr.supplierCallbackConfirmedAt?.toISOString() ?? null,
          lines: rr.lines.map((l) => ({
            productVariantId: l.productVariantId,
            sku: l.productVariant.sku,
            label: l.productVariant.name ?? l.productVariant.product.name,
            unitCode: l.productVariant.product.baseUnit.code,
          })),
        }}
        flags={{ hasReceiverSlip, hasCheckerSlip, hasTieBreakSlip, needsTieBreak }}
        currentUser={{ id: session.user.id, role: session.user.role }}
        branchUsers={users}
      />
    </div>
  );
}
