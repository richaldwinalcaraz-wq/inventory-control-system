import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { TransferForm } from "./TransferForm";

export default async function InventoryTransferPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");

  const variants = await prisma.productVariant.findMany({
    where: { status: "ACTIVE" },
    orderBy: { sku: "asc" },
    select: { id: true, sku: true, product: { select: { name: true } } },
  });

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-2 text-xl font-semibold text-slate-900">Counter Replenishment</h1>
      <p className="mb-6 text-sm text-slate-500">
        Moves stock from Storage to the Counter (sales-floor) location. Retail sales post against Counter, never Storage
        directly — this is what keeps counter stock tracked instead of a quiet leak.
      </p>
      <TransferForm variants={variants.map((v) => ({ id: v.id, label: `${v.sku} — ${v.product.name}` }))} />
    </div>
  );
}
