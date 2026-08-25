import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { ExportLinks } from "@/components/ui/ExportLinks";
import { getTrendReview } from "@/server/application/reporting/trendReview";
import { PermissionDeniedError } from "@/server/domain/rbac/assertPermission";

export default async function TrendReviewPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");

  let review;
  try {
    review = await getTrendReview(prisma, { actorRole: session.user.role });
  } catch (err) {
    if (err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Damage/Return Trend & Slow-Dead Stock"
        description={`Trailing ${review.windowDays} days.`}
        action={<ExportLinks reportId="trend-review" />}
      />

      <div className="flex flex-col gap-4">
        <Card className="overflow-x-auto">
          <div className="border-b border-slate-100 px-4 py-2">
            <h3 className="text-sm font-semibold text-slate-900">Weekly damage &amp; return trend</h3>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2">Week of</th>
                <th className="px-4 py-2 text-right">Damage reports</th>
                <th className="px-4 py-2 text-right">Damage qty</th>
                <th className="px-4 py-2 text-right">Returns</th>
                <th className="px-4 py-2 text-right">Return qty</th>
              </tr>
            </thead>
            <tbody>
              {review.weeklyTrend.length === 0 ? (
                <tr>
                  <td className="px-4 py-3 text-slate-500" colSpan={5}>
                    No damage reports or returns in this window.
                  </td>
                </tr>
              ) : (
                review.weeklyTrend.map((w) => (
                  <tr key={w.weekStart} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2">{w.weekStart}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{w.damageCount}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{w.damageQuantity}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{w.returnCount}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{w.returnQuantity}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>

        <Card className="overflow-x-auto">
          <div className="border-b border-slate-100 px-4 py-2">
            <h3 className="text-sm font-semibold text-slate-900">Slow / dead stock — no outbound movement in the window</h3>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2">SKU</th>
                <th className="px-4 py-2">Product</th>
                <th className="px-4 py-2 text-right">On hand</th>
                <th className="px-4 py-2">Last outbound</th>
              </tr>
            </thead>
            <tbody>
              {review.slowStock.length === 0 ? (
                <tr>
                  <td className="px-4 py-3 text-slate-500" colSpan={4}>
                    Every in-stock product has moved out within the window.
                  </td>
                </tr>
              ) : (
                review.slowStock.map((s) => (
                  <tr key={s.productVariantId} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-900">{s.sku}</td>
                    <td className="px-4 py-2">{s.productName}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.quantityOnHand}</td>
                    <td className="px-4 py-2">{s.lastOutboundAt ?? "Never"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
