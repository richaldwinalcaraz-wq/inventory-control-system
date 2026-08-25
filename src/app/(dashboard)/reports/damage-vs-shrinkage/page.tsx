import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getDamageVsShrinkageReport } from "@/server/application/reporting/damageVsShrinkage";
import { PermissionDeniedError } from "@/server/domain/rbac/assertPermission";

const WINDOW_DAYS = 90;

export default async function DamageVsShrinkageReportPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");

  let rows;
  try {
    rows = await getDamageVsShrinkageReport(prisma, { actorRole: session.user.role });
  } catch (err) {
    if (err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  const [branches, variants, locations] = await Promise.all([
    prisma.branch.findMany({ select: { id: true, name: true } }),
    prisma.productVariant.findMany({ select: { id: true, sku: true } }),
    prisma.warehouseLocation.findMany({ select: { id: true, zone: true, code: true } }),
  ]);
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? id.slice(0, 8);
  const variantSku = (id: string) => variants.find((v) => v.id === id)?.sku ?? id.slice(0, 8);
  const locationLabel = (id: string) => {
    const l = locations.find((loc) => loc.id === id);
    return l ? `${l.zone} (${l.code})` : id.slice(0, 8);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Damage vs. Shrinkage"
        description={`Trailing ${WINDOW_DAYS} days — locations with shortage adjustments (ADJ-01, posted) but disproportionately few damage reports flag a G-20 detection gap.`}
      />

      <Card className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2">Branch</th>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">Location</th>
              <th className="px-4 py-2">Damage reports</th>
              <th className="px-4 py-2">ADJ-01 (shortage) count</th>
              <th className="px-4 py-2">ADJ-01 value</th>
              <th className="px-4 py-2">Flag</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-slate-500" colSpan={7}>
                  No posted ADJ-01 shortage adjustments in the trailing window.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={`${r.branchId}:${r.productVariantId}:${r.warehouseLocationId}`} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2">{branchName(r.branchId)}</td>
                  <td className="px-4 py-2">{variantSku(r.productVariantId)}</td>
                  <td className="px-4 py-2">{locationLabel(r.warehouseLocationId)}</td>
                  <td className="px-4 py-2">{r.damageCount}</td>
                  <td className="px-4 py-2">{r.adjCount}</td>
                  <td className="px-4 py-2">₱{r.adjValue.toFixed(2)}</td>
                  <td className="px-4 py-2">{r.disproportionate ? <StatusBadge label="Review" tone="critical" /> : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
