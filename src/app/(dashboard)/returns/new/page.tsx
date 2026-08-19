import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { NewReturnForm } from "./NewReturnForm";

export default async function NewReturnPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");
  if (session.user.role !== "BRANCH_MANAGER" && session.user.role !== "OWNER") redirect("/returns");

  // Returns only make sense against goods actually handed over — POSTED
  // retail sale lines, and sales order lines with something released —
  // matching authorize.ts's own eligibility rules exactly.
  const [retailLines, wholesaleLines] = await Promise.all([
    prisma.retailSaleLine.findMany({
      where: { retailSale: { status: "POSTED" } },
      orderBy: { id: "desc" },
      take: 100,
      select: {
        id: true,
        quantity: true,
        productVariant: { select: { sku: true, product: { select: { name: true } } } },
        retailSale: { select: { documentNumber: { select: { fullNumber: true } } } },
      },
    }),
    prisma.salesOrderLine.findMany({
      where: { releasedQty: { gt: 0 } },
      orderBy: { id: "desc" },
      take: 100,
      select: {
        id: true,
        releasedQty: true,
        productVariant: { select: { sku: true, product: { select: { name: true } } } },
        salesOrder: { select: { customer: { select: { name: true } } } },
      },
    }),
  ]);

  const eligibleLines = [
    ...retailLines.map((l) => ({
      originalSaleType: "RetailSale" as const,
      originalSaleLineId: l.id,
      label: `${l.retailSale.documentNumber?.fullNumber ?? "(unposted)"} — ${l.productVariant.sku} (${l.productVariant.product.name}), qty ${l.quantity.toString()}`,
    })),
    ...wholesaleLines.map((l) => ({
      originalSaleType: "SalesOrder" as const,
      originalSaleLineId: l.id,
      label: `${l.salesOrder.customer.name} — ${l.productVariant.sku} (${l.productVariant.product.name}), released ${l.releasedQty.toString()}`,
    })),
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-xl font-semibold text-slate-900">Issue Return Authorization</h1>
      <NewReturnForm eligibleLines={eligibleLines} />
    </div>
  );
}
