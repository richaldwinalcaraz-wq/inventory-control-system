import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { NewDamageReportForm } from "./NewDamageReportForm";
import { PICKABLE_VARIANT_SELECT, PICKABLE_VARIANT_WHERE, variantPickerLabel } from "@/lib/variation";

export default async function NewDamageReportPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");
  const branchId = session.user.branchId;
  if (!branchId) throw new Error("Signed-in user has no branch assigned.");

  const [variants, locations] = await Promise.all([
    prisma.productVariant.findMany({ where: PICKABLE_VARIANT_WHERE, orderBy: [{ product: { name: "asc" } }, { displayOrder: { sort: "asc", nulls: "last" } }, { name: "asc" }, { sku: "asc" }], select: PICKABLE_VARIANT_SELECT }),
    prisma.warehouseLocation.findMany({ where: { warehouse: { branchId } }, orderBy: { zone: "asc" }, select: { id: true, zone: true, code: true } }),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-xl font-semibold text-slate-900">Report Damage</h1>
      <NewDamageReportForm
        variants={variants.map((v) => ({ id: v.id, label: variantPickerLabel(v) }))}
        locations={locations.map((l) => ({ id: l.id, label: `${l.zone} (${l.code})` }))}
      />
    </div>
  );
}
