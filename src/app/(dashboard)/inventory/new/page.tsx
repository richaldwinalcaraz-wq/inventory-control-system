import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { NewProductForm } from "./NewProductForm";

export default async function NewProductPage() {
  const session = await getAppSession();
  if (!session) redirect("/login");

  const [categories, units] = await Promise.all([
    prisma.category.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.unitOfMeasure.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold text-slate-900">New Product</h1>
      <p className="mb-6 text-sm text-slate-500">
        Adds the product to the catalog only — it starts at zero stock, same as any other product. Give it real
        quantity through Receiving (an actual delivery) or Adjustments (a found/corrected count).
      </p>
      <NewProductForm
        categories={categories.map((c) => ({ id: c.id, label: c.name }))}
        units={units.map((u) => ({ id: u.id, label: `${u.name} (${u.code})` }))}
      />
    </div>
  );
}
