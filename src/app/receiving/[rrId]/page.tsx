import { notFound, redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { ReceivingActionPanel } from "./ReceivingActionPanel";

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
          productVariant: { select: { sku: true, product: { select: { name: true } } } },
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

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-slate-900">Receiving Report — {rr.drNumber}</h1>
        <p className="text-sm text-slate-500">
          Supplier: {rr.supplier.name} · Status: <span className="font-medium">{rr.status}</span>
          {rr.documentNumber ? <> · Document #: {rr.documentNumber.fullNumber}</> : null}
        </p>
      </div>

      <div className="mb-6 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Product</th>
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
                <td className="px-3 py-2">{l.productVariant.product.name}</td>
                <td className="px-3 py-2">{l.expectedQty?.toString() ?? "—"}</td>
                <td className="px-3 py-2">{l.finalQty?.toString() ?? "—"}</td>
                <td className="px-3 py-2">{l.unitCost.toString()}</td>
                <td className="px-3 py-2">{l.lineStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ReceivingActionPanel
        rr={{
          id: rr.id,
          status: rr.status,
          receivedBy: rr.receivedBy,
          poReference: rr.poReference,
          supplierCallbackConfirmedAt: rr.supplierCallbackConfirmedAt?.toISOString() ?? null,
          lines: rr.lines.map((l) => ({ productVariantId: l.productVariantId, sku: l.productVariant.sku })),
        }}
        flags={{ hasReceiverSlip, hasCheckerSlip, hasTieBreakSlip, needsTieBreak }}
        currentUser={{ id: session.user.id, role: session.user.role }}
        branchUsers={users}
      />
    </main>
  );
}
