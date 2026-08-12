import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { NewSalesOrderForm } from "./NewSalesOrderForm";

export default async function NewSalesOrderPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");

  const [variants, customers] = await Promise.all([
    prisma.productVariant.findMany({ where: { status: "ACTIVE" }, orderBy: { sku: "asc" }, select: { id: true, sku: true, product: { select: { name: true } } } }),
    prisma.customer.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-xl font-semibold text-slate-900">New Wholesale Order</h1>
      <NewSalesOrderForm
        variants={variants.map((v) => ({ id: v.id, label: `${v.sku} — ${v.product.name}` }))}
        customers={customers}
      />
    </main>
  );
}
