import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/LinkButton";
import { ExportLinks } from "@/components/ui/ExportLinks";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getLowStockAlerts } from "@/server/application/reporting/lowStockAlerts";
import { PermissionDeniedError } from "@/server/domain/rbac/assertPermission";

export default async function LowStockAlertsPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");

  let rows;
  try {
    rows = await getLowStockAlerts(prisma, { actorRole: session.user.role, branchId: session.user.branchId ?? undefined });
  } catch (err) {
    if (err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Low Stock / Out of Stock"
        description="Products at or below their configured reorder point. Products with no reorder point set are not monitored — configure one to start alerting."
        action={
          <div className="flex items-center gap-2">
            <LinkButton href="/inventory/reorder-points">Manage reorder points</LinkButton>
            <ExportLinks reportId="low-stock-alerts" />
          </div>
        }
      />

      <Card className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2">Branch</th>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">Product</th>
              <th className="px-4 py-2 text-right">On hand</th>
              <th className="px-4 py-2 text-right">Reorder point</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-slate-500" colSpan={6}>
                  Nothing is low or out of stock among monitored products right now.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={`${r.branchId}:${r.productVariantId}`} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2">{r.branchName}</td>
                  <td className="px-4 py-2 font-medium text-slate-900">{r.sku}</td>
                  <td className="px-4 py-2">{r.productName}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.quantityOnHand}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.reorderPoint}</td>
                  <td className="px-4 py-2">
                    <StatusBadge label={r.status === "OUT_OF_STOCK" ? "Out of stock" : "Low stock"} tone={r.status === "OUT_OF_STOCK" ? "critical" : "warning"} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
