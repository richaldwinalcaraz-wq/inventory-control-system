import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";

const VIEWER_ROLES = new Set(["BRANCH_MANAGER", "AUDITOR", "OWNER"]);
const WINDOW_DAYS = 90;

export default async function DamageVsShrinkageReportPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");
  if (!VIEWER_ROLES.has(session.user.role)) redirect("/");

  const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [damageReports, shortageAdjustments] = await Promise.all([
    prisma.damageReport.findMany({
      where: { reportedAt: { gte: windowStart } },
      select: { branchId: true, productVariantId: true, warehouseLocationId: true, quantity: true },
    }),
    prisma.adjustmentRequest.findMany({
      where: { reasonCode: "ADJ_01", status: "POSTED", createdAt: { gte: windowStart } },
      select: { branchId: true, productVariantId: true, warehouseLocationId: true, value: true },
    }),
  ]);

  type Row = { branchId: string; productVariantId: string; warehouseLocationId: string; damageCount: number; adjCount: number; adjValue: number };
  const byKey = new Map<string, Row>();
  const keyOf = (b: string, p: string, w: string) => `${b}:${p}:${w}`;

  for (const d of damageReports) {
    const key = keyOf(d.branchId, d.productVariantId, d.warehouseLocationId);
    const row = byKey.get(key) ?? { branchId: d.branchId, productVariantId: d.productVariantId, warehouseLocationId: d.warehouseLocationId, damageCount: 0, adjCount: 0, adjValue: 0 };
    row.damageCount += 1;
    byKey.set(key, row);
  }
  for (const a of shortageAdjustments) {
    const key = keyOf(a.branchId, a.productVariantId, a.warehouseLocationId);
    const row = byKey.get(key) ?? { branchId: a.branchId, productVariantId: a.productVariantId, warehouseLocationId: a.warehouseLocationId, damageCount: 0, adjCount: 0, adjValue: 0 };
    row.adjCount += 1;
    row.adjValue += Number(a.value);
    byKey.set(key, row);
  }

  const rows = [...byKey.values()].filter((r) => r.adjCount > 0).sort((a, b) => b.adjValue - a.adjValue);

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
              rows.map((r) => {
                const disproportionate = r.damageCount === 0 || r.damageCount / r.adjCount < 0.5;
                return (
                  <tr key={`${r.branchId}:${r.productVariantId}:${r.warehouseLocationId}`} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2">{branchName(r.branchId)}</td>
                    <td className="px-4 py-2">{variantSku(r.productVariantId)}</td>
                    <td className="px-4 py-2">{locationLabel(r.warehouseLocationId)}</td>
                    <td className="px-4 py-2">{r.damageCount}</td>
                    <td className="px-4 py-2">{r.adjCount}</td>
                    <td className="px-4 py-2">₱{r.adjValue.toFixed(2)}</td>
                    <td className="px-4 py-2">{disproportionate ? <StatusBadge label="Review" tone="critical" /> : "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
