import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { NewAdjustmentForm } from "./NewAdjustmentForm";
import { navAllows } from "@/components/layout/nav-items";
import { PICKABLE_VARIANT_SELECT, PICKABLE_VARIANT_WHERE, variantPickerLabel } from "@/lib/variation";

export default async function NewAdjustmentPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");
  if (!navAllows(session.user.role, "/adjustments")) redirect("/");
  const branchId = session.user.branchId;
  if (!branchId) throw new Error("Signed-in user has no branch assigned.");

  const [variants, locations, damageReports] = await Promise.all([
    prisma.productVariant.findMany({ where: PICKABLE_VARIANT_WHERE, orderBy: [{ product: { name: "asc" } }, { displayOrder: { sort: "asc", nulls: "last" } }, { name: "asc" }, { sku: "asc" }], select: PICKABLE_VARIANT_SELECT }),
    prisma.warehouseLocation.findMany({ where: { warehouse: { branchId } }, orderBy: { zone: "asc" }, select: { id: true, zone: true, code: true } }),
    // ADJ_03 retirement: only fully-disposed reports (DISPOSED/CLOSED) are
    // eligible to link — matches adjustment/post.ts's own re-check.
    prisma.damageReport.findMany({
      where: { branchId, status: { in: ["DISPOSED", "CLOSED"] } },
      orderBy: { reportedAt: "desc" },
      select: { id: true, cause: true, quantity: true, productVariant: { select: { sku: true } } },
    }),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-xl font-semibold text-slate-900">New Adjustment Request</h1>
      <NewAdjustmentForm
        variants={variants.map((v) => ({ id: v.id, label: variantPickerLabel(v) }))}
        locations={locations.map((l) => ({ id: l.id, label: `${l.zone} (${l.code})` }))}
        damageReports={damageReports.map((r) => ({ id: r.id, label: `${r.productVariant.sku} — qty ${r.quantity.toString()} — ${r.cause}` }))}
      />
    </div>
  );
}
