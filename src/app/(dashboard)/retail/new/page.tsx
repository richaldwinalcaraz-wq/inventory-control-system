import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { peso } from "@/lib/money";
import { PICKABLE_VARIANT_SELECT, PICKABLE_VARIANT_WHERE, variantPickerLabel } from "@/lib/variation";
import { getSellingUnits } from "@/server/domain/catalog/pricing";
import { NewRetailSaleForm } from "./NewRetailSaleForm";

export default async function NewRetailSalePage() {
  const session = await getAppSession();
  if (!session) redirect("/login");

  const variants = await prisma.productVariant.findMany({
    where: PICKABLE_VARIANT_WHERE,
    orderBy: [{ product: { name: "asc" } }, { displayOrder: { sort: "asc", nulls: "last" } }, { name: "asc" }, { sku: "asc" }],
    select: PICKABLE_VARIANT_SELECT,
  });
  const retail = await getSellingUnits(
    prisma,
    variants.map((v) => v.id),
    { priceList: "RETAIL", branchId: session.user.branchId ?? null },
  );
  const retailPrice = (id: string) => retail.get(id)?.find((u) => u.isBaseUnit)?.price?.amount ?? null;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-xl font-semibold text-slate-900">New Retail Sale</h1>
      <NewRetailSaleForm
        variants={variants.map((v) => {
          const price = retailPrice(v.id);
          return { id: v.id, label: `${variantPickerLabel(v)} (${price ? peso(price) : "no retail price"})` };
        })}
      />
    </div>
  );
}
