import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { SalesOrderActionPanel } from "./SalesOrderActionPanel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { WHOLESALE_STATUS_TONE } from "../status";

export default async function SalesOrderDetailPage({ params }: { params: Promise<{ soId: string }> }) {
  const { soId } = await params;
  const session = await getAppSession();
  if (!session) redirect("/login");

  const order = await prisma.salesOrder.findUnique({
    where: { id: soId },
    include: {
      customer: { select: { name: true } },
      lines: { include: { productVariant: { select: { sku: true } } } },
      releases: { orderBy: { createdAt: "desc" }, select: { id: true, status: true, documentNumber: { select: { fullNumber: true } } } },
    },
  });
  if (!order) notFound();

  // Blind-check constraint: while a checker's recount is actively pending
  // (STAGED), never render pickedQty on the page at all.
  const showPickedQty = order.status !== "STAGED";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">
          Wholesale Order — {order.customer.name}
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <StatusBadge label={order.status} tone={WHOLESALE_STATUS_TONE[order.status] ?? "neutral"} />
          {order.spotRecountRequired ? <StatusBadge label="Spot recount flagged (G-10)" tone="warning" /> : null}
        </p>
      </div>

      <div className="mb-6 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Ordered</th>
              {showPickedQty ? <th className="px-3 py-2">Picked</th> : null}
              <th className="px-3 py-2">Checked</th>
              <th className="px-3 py-2">Released</th>
              <th className="px-3 py-2">Unit Price</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{l.productVariant.sku}</td>
                <td className="px-3 py-2">{l.orderedQty.toString()}</td>
                {showPickedQty ? <td className="px-3 py-2">{l.pickedQty?.toString() ?? "—"}</td> : null}
                <td className="px-3 py-2">{l.checkedQty?.toString() ?? "—"}</td>
                <td className="px-3 py-2">{l.releasedQty.toString()}</td>
                <td className="px-3 py-2">₱{Number(l.unitPrice).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {order.releases.length > 0 ? (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Releases</h2>
          <ul className="flex flex-col gap-1">
            {order.releases.map((r) => (
              <li key={r.id}>
                <Link href={`/wholesale/releases/${r.id}`} className="text-sm text-brand-700 hover:underline">
                  {r.id.slice(0, 8)} — {r.status} {r.documentNumber ? `(${r.documentNumber.fullNumber})` : ""}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <SalesOrderActionPanel
        order={{
          id: order.id,
          status: order.status,
          pickedBy: order.pickedBy,
          spotRecountRequired: order.spotRecountRequired,
          hasActiveReleases: order.releases.some((r) => r.status !== "VOID"),
          lines: order.lines.map((l) => ({
            id: l.id,
            productVariantId: l.productVariantId,
            sku: l.productVariant.sku,
            orderedQty: l.orderedQty.toString(),
            checkedQty: l.checkedQty?.toString() ?? null,
            releasedQty: l.releasedQty.toString(),
          })),
        }}
        currentUser={{ id: session.user.id, role: session.user.role }}
      />
    </div>
  );
}
