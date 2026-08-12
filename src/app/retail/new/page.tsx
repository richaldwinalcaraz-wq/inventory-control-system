import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { NewRetailSaleForm } from "./NewRetailSaleForm";

export default async function NewRetailSalePage() {
  const session = await getAppSession();
  if (!session) redirect("/login");

  const variants = await prisma.productVariant.findMany({
    where: { status: "ACTIVE" },
    orderBy: { sku: "asc" },
    select: { id: true, sku: true, sellingPrice: true, product: { select: { name: true } } },
  });

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-xl font-semibold text-slate-900">New Retail Sale</h1>
      <NewRetailSaleForm
        variants={variants.map((v) => ({ id: v.id, label: `${v.sku} — ${v.product.name} (₱${Number(v.sellingPrice).toFixed(2)})` }))}
      />
    </main>
  );
}
