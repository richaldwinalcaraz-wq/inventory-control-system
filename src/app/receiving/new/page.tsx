import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { NewReceivingForm } from "./NewReceivingForm";

export default async function NewReceivingReportPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");

  const [suppliers, variants] = await Promise.all([
    prisma.supplier.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.productVariant.findMany({
      where: { status: "ACTIVE" },
      orderBy: { sku: "asc" },
      select: { id: true, sku: true, product: { select: { name: true } } },
    }),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-xl font-semibold text-slate-900">New Receiving Report</h1>
      <NewReceivingForm
        suppliers={suppliers}
        variants={variants.map((v) => ({ id: v.id, label: `${v.sku} — ${v.product.name}` }))}
      />
    </main>
  );
}
