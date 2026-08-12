import { notFound, redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { ReleaseActionPanel } from "./ReleaseActionPanel";

export default async function ReleaseDetailPage({ params }: { params: Promise<{ releaseId: string }> }) {
  const { releaseId } = await params;
  const session = await getAppSession();
  if (!session) redirect("/login");

  const release = await prisma.salesOrderRelease.findUnique({
    where: { id: releaseId },
    include: {
      lines: { include: { salesOrderLine: { include: { productVariant: { select: { sku: true } } } } } },
      documentNumber: { select: { fullNumber: true } },
      salesOrder: { select: { id: true, customer: { select: { name: true } } } },
    },
  });
  if (!release) notFound();

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Release — {release.salesOrder.customer.name}</h1>
        <p className="text-sm text-slate-500">
          Status: <span className="font-medium">{release.status}</span>
          {release.documentNumber ? <> · Document #: {release.documentNumber.fullNumber}</> : null}
        </p>
      </div>

      <div className="mb-6 rounded-lg border border-slate-200 p-4 text-sm">
        <dl className="grid grid-cols-2 gap-y-2">
          <dt className="text-slate-500">Expected weight band</dt>
          <dd>
            {release.expectedWeightMinKg ? `${Number(release.expectedWeightMinKg).toFixed(2)} – ${Number(release.expectedWeightMaxKg).toFixed(2)} kg` : "—"}
          </dd>
          <dt className="text-slate-500">Actual weight</dt>
          <dd>{release.actualWeightKg ? `${Number(release.actualWeightKg).toFixed(2)} kg` : "—"}</dd>
          <dt className="text-slate-500">Weight check</dt>
          <dd>{release.weightCheckPassed === null ? "—" : release.weightCheckPassed ? "PASSED" : "FAILED"}</dd>
          <dt className="text-slate-500">Seal</dt>
          <dd>{release.sealNumber ?? "—"} {release.sealVerifiedIntact === null ? "" : release.sealVerifiedIntact ? "(intact)" : "(BROKEN)"}</dd>
          <dt className="text-slate-500">POD returned</dt>
          <dd>{release.podReturnedAt ? release.podReturnedAt.toISOString().slice(0, 10) : "not yet"}</dd>
          <dt className="text-slate-500">Customer confirmed</dt>
          <dd>{release.customerConfirmedAt ? release.customerConfirmedAt.toISOString().slice(0, 10) : "not yet"}</dd>
        </dl>
      </div>

      <div className="mb-6 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Qty released</th>
            </tr>
          </thead>
          <tbody>
            {release.lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{l.salesOrderLine.productVariant.sku}</td>
                <td className="px-3 py-2">{l.qty.toString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ReleaseActionPanel
        release={{ id: release.id, status: release.status, weightCheckPassed: release.weightCheckPassed, sealVerifiedIntact: release.sealVerifiedIntact, podReturnedAt: release.podReturnedAt !== null }}
        currentUser={{ role: session.user.role }}
      />
    </main>
  );
}
