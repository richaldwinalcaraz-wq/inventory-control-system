import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { NewAdjustmentForm } from "./NewAdjustmentForm";

export default async function NewAdjustmentPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");
  const branchId = session.user.branchId;
  if (!branchId) throw new Error("Signed-in user has no branch assigned.");

  const [variants, locations, damageReports] = await Promise.all([
    prisma.productVariant.findMany({ where: { status: "ACTIVE" }, orderBy: { sku: "asc" }, select: { id: true, sku: true, product: { select: { name: true } } } }),
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
        variants={variants.map((v) => ({ id: v.id, label: `${v.sku} — ${v.product.name}` }))}
        locations={locations.map((l) => ({ id: l.id, label: `${l.zone} (${l.code})` }))}
        damageReports={damageReports.map((r) => ({ id: r.id, label: `${r.productVariant.sku} — qty ${r.quantity.toString()} — ${r.cause}` }))}
      />
    </div>
  );
}
