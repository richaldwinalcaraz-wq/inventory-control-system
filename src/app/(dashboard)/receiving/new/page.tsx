import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { NewReceivingForm } from "./NewReceivingForm";
import { PICKABLE_VARIANT_SELECT, PICKABLE_VARIANT_WHERE, variantPickerLabel } from "@/lib/variation";

export default async function NewReceivingReportPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");

  const [suppliers, variants] = await Promise.all([
    prisma.supplier.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.productVariant.findMany({ where: PICKABLE_VARIANT_WHERE, orderBy: [{ product: { name: "asc" } }, { displayOrder: { sort: "asc", nulls: "last" } }, { name: "asc" }, { sku: "asc" }], select: PICKABLE_VARIANT_SELECT }),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-xl font-semibold text-slate-900">New Receiving Report</h1>
      <NewReceivingForm
        suppliers={suppliers}
        variants={variants.map((v) => ({ id: v.id, label: variantPickerLabel(v) }))}
      />
    </div>
  );
}
