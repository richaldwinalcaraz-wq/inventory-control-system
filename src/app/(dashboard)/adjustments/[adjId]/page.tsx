import { notFound, redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { AdjustmentActionPanel } from "./AdjustmentActionPanel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ADJUSTMENT_STATUS_TONE } from "../status";

export default async function AdjustmentDetailPage({ params }: { params: Promise<{ adjId: string }> }) {
  const { adjId } = await params;
  const session = await getAppSession();
  if (!session) redirect("/login");

  const req = await prisma.adjustmentRequest.findUnique({
    where: { id: adjId },
    include: {
      documentNumber: { select: { fullNumber: true } },
      productVariant: { select: { sku: true, product: { select: { name: true } } } },
      warehouseLocation: { select: { code: true, zone: true } },
    },
  });
  if (!req) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">
          Adjustment — {req.productVariant.sku} ({req.reasonCode})
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <StatusBadge label={req.status} tone={ADJUSTMENT_STATUS_TONE[req.status] ?? "neutral"} />
          {req.documentNumber ? <>Document #: {req.documentNumber.fullNumber}</> : null}
        </p>
      </div>

      <div className="mb-6 rounded-lg border border-slate-200 p-4 text-sm">
        <dl className="grid grid-cols-2 gap-y-2">
          <dt className="text-slate-500">Product</dt>
          <dd>{req.productVariant.product.name}</dd>
          <dt className="text-slate-500">Location</dt>
          <dd>
            {req.warehouseLocation.zone} ({req.warehouseLocation.code})
          </dd>
          <dt className="text-slate-500">Quantity Δ</dt>
          <dd>{req.quantityDelta.toString()}</dd>
          <dt className="text-slate-500">Unit cost at request</dt>
          <dd>₱{Number(req.unitCostAtRequest).toFixed(2)}</dd>
          <dt className="text-slate-500">Value</dt>
          <dd>₱{Number(req.value).toFixed(2)}</dd>
          <dt className="text-slate-500">Reconciliation notes</dt>
          <dd className="col-span-2 whitespace-pre-wrap text-slate-700">{req.reconciliationNotes}</dd>
          {req.investigationNotes ? (
            <>
              <dt className="text-slate-500">Investigation notes</dt>
              <dd className="col-span-2 whitespace-pre-wrap text-slate-700">{req.investigationNotes}</dd>
            </>
          ) : null}
        </dl>
      </div>

      <AdjustmentActionPanel
        adjId={req.id}
        status={req.status}
        requestedBy={req.requestedBy}
        currentUser={{ id: session.user.id, role: session.user.role }}
      />
    </div>
  );
}
