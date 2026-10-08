import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAppSession } from "@/lib/authSession";
import { prisma } from "@/lib/prisma";
import { navAllows } from "@/components/layout/nav-items";
import { Card } from "@/components/ui/Card";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { isOwner } from "@/lib/roleModel";
import { peso } from "@/lib/money";
import { getSellingUnits } from "@/server/domain/catalog/pricing";
import { SellingUnitsPanel, type PanelUnit } from "./SellingUnitsPanel";

const STATUS_TONE: Record<string, StatusTone> = { ACTIVE: "success", INACTIVE: "warning", ARCHIVED: "neutral" };
const AUDIT_LABELS: Record<string, string> = {
  "catalog.parent.created": "Product created",
  "catalog.parent.updated": "Product updated",
  "catalog.parent.archived": "Product archived",
  "catalog.parent.restored": "Product restored",
  "catalog.child.added": "Variant added",
  "catalog.child.updated": "Variant updated",
  "catalog.child.archived": "Variant archived",
  "catalog.child.restored": "Variant restored",
  "catalog.child.parent_changed": "Moved to another product",
  "catalog.price.set": "Price set",
  "catalog.price.removed": "Stopped selling in a unit",
  "catalog.pack_size.proposed": "Pack size proposed",
  "catalog.pack_size.checked": "Pack size checked (1 of 2)",
  "catalog.pack_size.activated": "Pack size confirmed (2 of 2)",
  "catalog.pack_size.rejected": "Pack size count did not match",
  "inventory.reorder_point.updated": "Reorder point updated",
};
const humanize = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
const dateTime = (d: Date) => d.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

function describeChange(before: unknown, after: unknown): string {
  if (!after || typeof after !== "object") return "";
  const b = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  return Object.entries(after as Record<string, unknown>)
    .filter(([k]) => !k.endsWith("ProductId"))
    .map(([k, v]) => (k in b ? `${k}: ${JSON.stringify(b[k])} → ${JSON.stringify(v)}` : `${k}: ${JSON.stringify(v)}`))
    .join(" · ");
}

export default async function VariantDetailPage({ params }: { params: Promise<{ variantId: string }> }) {
  const session = await getAppSession();
  if (!session) redirect("/login");
  if (!navAllows(session.user.role, "/inventory")) redirect("/");
  const { variantId } = await params;

  const child = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: { product: { include: { category: { select: { name: true } }, baseUnit: { select: { code: true, name: true } } } } },
  });
  if (!child) notFound();
  const parent = child.product;

  const [balances, movements, audits, sellingUnits, priceHistory, importRows, allUnits] = await Promise.all([
    prisma.stockBalance.findMany({
      where: { productVariantId: child.id },
      select: { quantityOnHand: true, warehouseLocation: { select: { zone: true, warehouse: { select: { branch: { select: { id: true, code: true, name: true } } } } } } },
    }),
    prisma.stockLedger.findMany({
      where: { productVariantId: child.id },
      orderBy: { sequenceNo: "desc" },
      take: 20,
      select: { id: true, createdAt: true, movementType: true, quantityDeltaBase: true, documentNumber: true, performedBy: true, branch: { select: { code: true } } },
    }),
    prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: "ProductVariant", entityId: child.id },
          { entityType: "Product", entityId: parent.id, action: { startsWith: "catalog.parent." } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    getSellingUnits(prisma, [child.id]),
    prisma.variantPrice.findMany({
      where: { productVariantId: child.id },
      orderBy: { effectiveFrom: "desc" },
      take: 20,
      include: { unit: { select: { name: true } }, branch: { select: { code: true } } },
    }),
    prisma.catalogImportRow.findMany({ where: { productVariantId: child.id }, include: { batch: { select: { sourceFile: true, createdAt: true } } } }),
    prisma.unitOfMeasure.findMany({ orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
  ]);

  const actorIds = [...new Set([...movements.map((m) => m.performedBy), ...audits.map((a) => a.actorId), ...priceHistory.map((p) => p.createdBy)])];
  const actors = new Map((await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));

  const byBranch = new Map<string, { code: string; name: string; qty: number }>();
  for (const b of balances) {
    const branch = b.warehouseLocation.warehouse.branch;
    const row = byBranch.get(branch.id) ?? { code: branch.code, name: branch.name, qty: 0 };
    row.qty += Number(b.quantityOnHand);
    byBranch.set(branch.id, row);
  }
  const totalUnits = [...byBranch.values()].reduce((sum, r) => sum + r.qty, 0);
  const units = sellingUnits.get(child.id) ?? [];
  const panelUnits: PanelUnit[] = units.map((u) => ({
    unitId: u.unitId,
    unitCode: u.unitCode,
    unitName: u.unitName,
    isBaseUnit: u.isBaseUnit,
    baseQtyPerUnit: u.baseQtyPerUnit,
    price: u.price?.amount ?? null,
    pending: u.pendingPackSize
      ? {
          conversionRateVersionId: u.pendingPackSize.conversionRateVersionId,
          rate: u.pendingPackSize.rate,
          checksDone: u.pendingPackSize.verifiedByUser1 ? 1 : 0,
          canCheck: u.pendingPackSize.proposedBy !== session.user.id && u.pendingPackSize.verifiedByUser1 !== session.user.id,
        }
      : null,
  }));
  const addableUnits = allUnits.filter((u) => !units.some((x) => x.unitId === u.id));
  const openQuestions = importRows.flatMap((r) => (Array.isArray(r.issues) ? (r.issues as string[]) : []));
  const variation = child.variationData && typeof child.variationData === "object" && !Array.isArray(child.variationData) ? Object.entries(child.variationData as Record<string, string>) : [];

  return (
    <div className="mx-auto max-w-5xl">
      <Link href={`/inventory?q=${encodeURIComponent(parent.name)}`} className="text-sm font-medium text-brand-700 hover:underline">
        ← Back to {parent.name}
      </Link>

      <div className="mb-6 mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{parent.name} · Variant</p>
          <h1 className="text-xl font-semibold text-slate-900">{child.name ?? parent.name}</h1>
        </div>
        <StatusBadge label={humanize(child.status)} tone={STATUS_TONE[child.status] ?? "neutral"} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Product</h2>
          <p className="text-sm font-semibold">{parent.name}</p>
          <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-y-1.5 text-sm">
            <dt className="text-slate-500">ASIN</dt>
            <dd className="font-mono">{parent.asin ?? "—"}</dd>
            <dt className="text-slate-500">Brand</dt>
            <dd>{parent.brand ?? "—"}</dd>
            <dt className="text-slate-500">Category</dt>
            <dd>{parent.category?.name ?? "—"}</dd>
            <dt className="text-slate-500">Status</dt>
            <dd>{humanize(parent.status)}</dd>
          </dl>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Details</h2>
          <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5 text-sm">
            <dt className="text-slate-500">SKU</dt>
            <dd className="font-mono">{child.sku}</dd>
            <dt className="text-slate-500">Variation</dt>
            <dd>{variation.length ? variation.map(([k, v]) => `${k}: ${v}`).join(", ") : "—"}</dd>
            <dt className="text-slate-500">ASIN</dt>
            <dd className="font-mono">{child.asin ?? "—"}</dd>
            <dt className="text-slate-500">Stock unit</dt>
            <dd>{parent.baseUnit.name}</dd>
            <dt className="text-slate-500">Barcode</dt>
            <dd>{child.barcode ?? "—"}</dd>
            <dt className="text-slate-500">Notes</dt>
            <dd className="whitespace-pre-line">{child.notes ?? "—"}</dd>
          </dl>
        </Card>
      </div>

      <SellingUnitsPanel variantId={child.id} baseUnit={parent.baseUnit} units={panelUnits} addableUnits={addableUnits} canManage={isOwner(session.user.role) && child.status !== "ARCHIVED"} />

      {openQuestions.length > 0 ? (
        <Card className="mb-6 border-amber-200 bg-amber-50/60 p-4">
          <h2 className="mb-2 text-sm font-semibold text-amber-900">Open questions from the price list</h2>
          <ul className="list-disc pl-5 text-sm text-amber-900">
            {openQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-800">
            Imported from {importRows[0]!.batch.sourceFile}, row {importRows[0]!.sourceRow}: &ldquo;{importRows[0]!.originalText.trim()}&rdquo;
          </p>
        </Card>
      ) : null}

      <h2 className="mb-2 text-sm font-semibold text-slate-900">Stock on hand ({parent.baseUnit.code})</h2>
      <Card className="mb-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2">Branch</th>
              <th className="px-4 py-2 text-right">On hand</th>
            </tr>
          </thead>
          <tbody>
            {[...byBranch.values()].map((b) => (
              <tr key={b.code} className="border-t border-slate-100">
                <td className="px-4 py-2">
                  {b.code} <span className="text-slate-500">— {b.name}</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{b.qty.toLocaleString("en-PH")}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
              <td className="px-4 py-2">Total</td>
              <td className="px-4 py-2 text-right tabular-nums">{totalUnits.toLocaleString("en-PH")}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      <h2 className="mb-2 text-sm font-semibold text-slate-900">Recent stock movements</h2>
      <Card className="mb-6 overflow-x-auto">
        {movements.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">No stock movements yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Branch</th>
                <th className="px-4 py-2">Movement</th>
                <th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2">Document</th>
                <th className="px-4 py-2">By</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => {
                const qty = Number(m.quantityDeltaBase);
                return (
                  <tr key={m.id.toString()} className="border-t border-slate-100">
                    <td className="px-4 py-2 text-slate-600">{dateTime(m.createdAt)}</td>
                    <td className="px-4 py-2">{m.branch.code}</td>
                    <td className="px-4 py-2">{humanize(m.movementType)}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${qty < 0 ? "text-red-700" : "text-brand-800"}`}>{qty > 0 ? `+${qty}` : qty}</td>
                    <td className="px-4 py-2 font-mono text-xs">{m.documentNumber}</td>
                    <td className="px-4 py-2">{actors.get(m.performedBy) ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <h2 className="mb-2 text-sm font-semibold text-slate-900">Price history</h2>
      <Card className="mb-6 overflow-x-auto">
        {priceHistory.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">No prices set yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2">From</th>
                <th className="px-4 py-2">Until</th>
                <th className="px-4 py-2">Unit</th>
                <th className="px-4 py-2">List</th>
                <th className="px-4 py-2 text-right">Price</th>
                <th className="px-4 py-2">Set by</th>
              </tr>
            </thead>
            <tbody>
              {priceHistory.map((p) => (
                <tr key={p.id} className={`border-t border-slate-100 ${p.supersededAt ? "text-slate-500" : ""}`}>
                  <td className="px-4 py-2">{dateTime(p.effectiveFrom)}</td>
                  <td className="px-4 py-2">{p.supersededAt ? dateTime(p.supersededAt) : <span className="font-medium text-brand-800">Current</span>}</td>
                  <td className="px-4 py-2">{p.unit.name}</td>
                  <td className="px-4 py-2">
                    {humanize(p.priceList)}
                    {p.branch ? ` · ${p.branch.code}` : ""}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{peso(p.price.toString())}</td>
                  <td className="px-4 py-2">{actors.get(p.createdBy) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <h2 className="mb-2 text-sm font-semibold text-slate-900">Change history</h2>
      <Card className="overflow-x-auto">
        {audits.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">No changes recorded.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {audits.map((a) => (
              <li key={a.id.toString()} className="px-4 py-3 text-sm">
                <p>
                  <span className="font-medium text-slate-900">{AUDIT_LABELS[a.action] ?? a.action}</span>
                  <span className="text-slate-500"> · {actors.get(a.actorId) ?? "Unknown user"} · {dateTime(a.createdAt)}</span>
                </p>
                <p className="mt-0.5 break-words text-xs text-slate-500">{describeChange(a.beforeState, a.afterState)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
