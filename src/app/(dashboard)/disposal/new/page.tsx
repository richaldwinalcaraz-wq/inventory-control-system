import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { NewDamageReportForm } from "./NewDamageReportForm";

export default async function NewDamageReportPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");
  const branchId = session.user.branchId;
  if (!branchId) throw new Error("Signed-in user has no branch assigned.");

  const [variants, locations] = await Promise.all([
    prisma.productVariant.findMany({ where: { status: "ACTIVE" }, orderBy: { sku: "asc" }, select: { id: true, sku: true, product: { select: { name: true } } } }),
    prisma.warehouseLocation.findMany({ where: { warehouse: { branchId } }, orderBy: { zone: "asc" }, select: { id: true, zone: true, code: true } }),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-xl font-semibold text-slate-900">Report Damage</h1>
      <NewDamageReportForm
        variants={variants.map((v) => ({ id: v.id, label: `${v.sku} — ${v.product.name}` }))}
        locations={locations.map((l) => ({ id: l.id, label: `${l.zone} (${l.code})` }))}
      />
    </div>
  );
}
