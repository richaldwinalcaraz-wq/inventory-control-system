"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CaretDownIcon, CaretRightIcon, FolderIcon, FolderOpenIcon } from "@phosphor-icons/react/dist/ssr";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import type { CatalogChildRow, CatalogParentRow, CatalogUnitSummary, CatalogViewMode } from "../catalogView";
import { ParentAsinModal } from "./ParentAsinModal";
import { ChildAsinModal, type ChildParentContext } from "./ChildAsinModal";
import { PricesModal } from "./PricesModal";
import { dangerButton, primaryButton, secondaryButton, sendJson } from "./api";
import { peso } from "@/lib/money";

const STATUS_TONE: Record<string, StatusTone> = { ACTIVE: "success", INACTIVE: "warning", ARCHIVED: "neutral" };
const statusLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const fmt = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 4 });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

interface Option {
  id: string;
  label: string;
}

type Dialog =
  | { kind: "createParent" }
  | { kind: "editParent"; parent: CatalogParentRow }
  | { kind: "addChild"; parent: CatalogParentRow }
  | { kind: "editChild"; parent: CatalogParentRow; child: CatalogChildRow }
  | { kind: "prices"; parent: CatalogParentRow; child: CatalogChildRow }
  | { kind: "archiveParent"; parent: CatalogParentRow }
  | { kind: "archiveChild"; parent: CatalogParentRow; child: CatalogChildRow };

const asParentContext = (p: CatalogParentRow): ChildParentContext => ({ id: p.id, asin: p.asin, name: p.name, baseUnitId: p.baseUnitId, baseUnitCode: p.baseUnitCode });

/** "Sack ₱4,000.00 · 40 RIM" per priced unit, with its retail price under it; a pack size still awaiting its checks is marked. */
function UnitPrices({ units, baseUnitCode }: { units: CatalogUnitSummary[]; baseUnitCode: string }) {
  const priced = units.filter((u) => u.price !== null || u.retailPrice !== null);
  if (priced.length === 0) return <span className="text-slate-400">No prices yet</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {priced.map((u) => (
        <li key={u.code} className="whitespace-nowrap">
          <span className="text-slate-600">{u.name}</span>{" "}
          {u.price !== null ? <span className="font-medium tabular-nums text-slate-900">{peso(u.price)}</span> : <span className="text-slate-400">no wholesale</span>}
          {u.isBaseUnit ? null : u.baseQtyPerUnit !== null ? (
            <span className="text-xs text-slate-500">
              {" "}
              · {fmt(u.baseQtyPerUnit)} {baseUnitCode}
            </span>
          ) : (
            <span className="ml-1 rounded bg-amber-50 px-1 text-xs text-amber-800" title="Pack size waiting for two people to check it on first delivery">
              {u.pendingBaseQty !== null ? `${fmt(u.pendingBaseQty)} ${baseUnitCode}?` : "size?"}
            </span>
          )}
          {u.retailPrice !== null ? <span className="block text-xs tabular-nums text-slate-500">retail {peso(u.retailPrice)}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function VariantCell({ child }: { child: CatalogChildRow }) {
  return (
    <>
      <span className="font-medium text-slate-900">{child.displayName}</span>
      {child.variation ? <span className="block text-xs text-slate-500">{child.variation}</span> : null}
      {child.asin ? <span className="block font-mono text-xs text-slate-500">ASIN {child.asin}</span> : null}
    </>
  );
}

export function CatalogTree({
  rows,
  view,
  branches,
  categories,
  units,
  brands,
  moveTargets,
  canManage,
}: {
  rows: CatalogParentRow[];
  view: CatalogViewMode;
  branches: Array<{ id: string; code: string }>;
  categories: Option[];
  units: Option[];
  brands: string[];
  moveTargets: ChildParentContext[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(rows.filter((r) => r.expandedBySearch).map((r) => r.id)));
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function done(message: string, openParentId?: string) {
    setDialog(null);
    setNotice({ tone: "ok", text: message });
    if (openParentId) setExpanded((prev) => new Set(prev).add(openParentId));
    router.refresh();
  }

  async function act(url: string, message: string, openParentId?: string) {
    setPending(true);
    try {
      await sendJson(url, "POST");
      done(message, openParentId);
    } catch (err) {
      setDialog(null);
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setPending(false);
    }
  }

  const childActions = (parent: CatalogParentRow, child: CatalogChildRow) => (
    <div className="flex justify-end gap-3 text-sm">
      <Link href={`/inventory/items/${child.id}`} className="font-medium text-brand-700 hover:underline">
        View
      </Link>
      {canManage && child.status !== "ARCHIVED" ? (
        <>
          <button type="button" onClick={() => setDialog({ kind: "prices", parent, child })} className="font-medium text-brand-700 hover:underline">
            Prices
          </button>
          <button type="button" onClick={() => setDialog({ kind: "editChild", parent, child })} className="font-medium text-slate-700 hover:underline">
            Edit
          </button>
          <button type="button" onClick={() => setDialog({ kind: "archiveChild", parent, child })} className="font-medium text-red-700 hover:underline">
            Archive
          </button>
        </>
      ) : null}
      {canManage && child.status === "ARCHIVED" && parent.status !== "ARCHIVED" ? (
        <button type="button" disabled={pending} onClick={() => act(`/api/v1/catalog/children/${child.id}/restore`, `${child.displayName} restored.`, parent.id)} className="font-medium text-slate-700 hover:underline">
          Restore
        </button>
      ) : null}
    </div>
  );

  return (
    <>
      {notice ? (
        <div role="status" className={`mb-4 flex items-start justify-between gap-4 rounded-md px-4 py-3 text-sm ${notice.tone === "ok" ? "bg-brand-50 text-brand-900" : "bg-red-50 text-red-800"}`}>
          <span>{notice.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="opacity-60 hover:opacity-100">
            ✕
          </button>
        </div>
      ) : null}

      {canManage ? (
        <div className="mb-4 flex justify-end">
          <button type="button" onClick={() => setDialog({ kind: "createParent" })} className={primaryButton}>
            + Add Product
          </button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <Card className="px-6 py-10 text-center text-sm text-slate-500">No products or variants match these filters.</Card>
      ) : view === "children" ? (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2">Variant</th>
                <th className="px-4 py-2">SKU</th>
                <th className="px-4 py-2">Prices</th>
                <th className="px-4 py-2">Product</th>
                <th className="px-4 py-2 text-right">On hand</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.flatMap((parent) =>
                parent.children.map((child) => (
                  <tr key={child.id} className="border-t border-slate-100 align-top hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <VariantCell child={child} />
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-700">{child.sku}</td>
                    <td className="px-4 py-2">
                      <UnitPrices units={child.units ?? []} baseUnitCode={parent.baseUnitCode} />
                    </td>
                    <td className="px-4 py-2">{parent.name}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {fmt(child.totalUnits)} <span className="text-xs text-slate-500">{parent.baseUnitCode}</span>
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge label={statusLabel(child.status)} tone={STATUS_TONE[child.status] ?? "neutral"} />
                    </td>
                    <td className="px-4 py-2">{childActions(parent, child)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((parent) => {
            const open = expanded.has(parent.id);
            const panelId = `parent-panel-${parent.id}`;
            return (
              <li key={parent.id}>
                <Card>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <button type="button" onClick={() => toggle(parent.id)} aria-expanded={open} aria-controls={panelId} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      {open ? <CaretDownIcon size={16} className="shrink-0 text-slate-500" /> : <CaretRightIcon size={16} className="shrink-0 text-slate-500" />}
                      {open ? <FolderOpenIcon size={22} className="shrink-0 text-brand-700" /> : <FolderIcon size={22} className="shrink-0 text-brand-700" />}
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="truncate font-medium text-slate-900">{parent.name}</span>
                          {parent.asin ? <span className="font-mono text-xs text-slate-500">ASIN {parent.asin}</span> : null}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {plural(parent.liveChildCount, "variant")} · {fmt(parent.totalUnits)} {parent.baseUnitCode} on hand
                          {parent.brand ? ` · ${parent.brand}` : ""}
                          {parent.categoryName && parent.categoryName !== parent.name ? ` · ${parent.categoryName}` : ""}
                        </span>
                      </span>
                    </button>
                    <StatusBadge label={statusLabel(parent.status)} tone={STATUS_TONE[parent.status] ?? "neutral"} />
                    {canManage ? (
                      <div className="flex gap-3 text-sm">
                        {parent.status === "ARCHIVED" ? (
                          <button type="button" disabled={pending} onClick={() => act(`/api/v1/catalog/parents/${parent.id}/restore`, `${parent.name} restored.`)} className="font-medium text-slate-700 hover:underline">
                            Restore
                          </button>
                        ) : (
                          <>
                            <button type="button" onClick={() => setDialog({ kind: "editParent", parent })} className="font-medium text-slate-700 hover:underline">
                              Edit
                            </button>
                            <button type="button" onClick={() => setDialog({ kind: "archiveParent", parent })} className="font-medium text-red-700 hover:underline">
                              Archive
                            </button>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>

                  {open ? (
                    <div id={panelId} className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                      {parent.description ? <p className="mb-3 text-sm text-slate-600">{parent.description}</p> : null}
                      {parent.children.length === 0 ? (
                        <p className="py-2 text-sm text-slate-500">No variants {parent.liveChildCount > 0 ? "match these filters" : "added yet"}.</p>
                      ) : (
                        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50 text-slate-600">
                              <tr>
                                <th className="px-3 py-2">Variant</th>
                                <th className="px-3 py-2">SKU</th>
                                <th className="px-3 py-2">Prices</th>
                                {branches.map((b) => (
                                  <th key={b.id} className="px-3 py-2 text-right">
                                    {b.code}
                                  </th>
                                ))}
                                <th className="px-3 py-2 text-right">Total {parent.baseUnitCode}</th>
                                <th className="px-3 py-2">Status</th>
                                <th className="px-3 py-2" />
                              </tr>
                            </thead>
                            <tbody>
                              {parent.children.map((child) => (
                                <tr key={child.id} className={`border-t border-slate-100 align-top ${child.matched ? "bg-amber-50" : "hover:bg-slate-50"}`}>
                                  <td className="px-3 py-2">
                                    <VariantCell child={child} />
                                  </td>
                                  <td className="px-3 py-2 font-mono text-xs text-slate-700">{child.sku}</td>
                                  <td className="px-3 py-2">
                                    <UnitPrices units={child.units ?? []} baseUnitCode={parent.baseUnitCode} />
                                  </td>
                                  {branches.map((b) => (
                                    <td key={b.id} className="px-3 py-2 text-right tabular-nums">
                                      {fmt(child.byBranch[b.id] ?? 0)}
                                    </td>
                                  ))}
                                  <td className="px-3 py-2 text-right font-medium tabular-nums">{fmt(child.totalUnits)}</td>
                                  <td className="px-3 py-2">
                                    <StatusBadge label={statusLabel(child.status)} tone={STATUS_TONE[child.status] ?? "neutral"} />
                                  </td>
                                  <td className="px-3 py-2">{childActions(parent, child)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {canManage && parent.status !== "ARCHIVED" ? (
                        <button type="button" onClick={() => setDialog({ kind: "addChild", parent })} className="mt-3 text-sm font-medium text-brand-700 hover:underline">
                          + Add Variant
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {dialog?.kind === "createParent" ? <ParentAsinModal categories={categories} units={units} brands={brands} onClose={() => setDialog(null)} onSaved={(m) => done(m)} /> : null}
      {dialog?.kind === "editParent" ? <ParentAsinModal initial={dialog.parent} categories={categories} units={units} brands={brands} onClose={() => setDialog(null)} onSaved={(m) => done(m)} /> : null}
      {dialog?.kind === "addChild" ? (
        <ChildAsinModal parent={asParentContext(dialog.parent)} moveTargets={[]} onClose={() => setDialog(null)} onSaved={(m) => done(m, dialog.parent.id)} />
      ) : null}
      {dialog?.kind === "editChild" ? (
        <ChildAsinModal
          parent={asParentContext(dialog.parent)}
          initial={dialog.child}
          moveTargets={moveTargets.filter((p) => p.baseUnitId === dialog.parent.baseUnitId)}
          onClose={() => setDialog(null)}
          onSaved={(m) => done(m, dialog.parent.id)}
        />
      ) : null}

      {dialog?.kind === "prices" ? (
        <PricesModal
          variantId={dialog.child.id}
          variantName={dialog.child.displayName}
          baseUnitCode={dialog.parent.baseUnitCode}
          units={dialog.child.units ?? []}
          onClose={() => setDialog(null)}
          onSaved={(m) => done(m, dialog.parent.id)}
          onPartialSave={() => router.refresh()}
        />
      ) : null}

      {dialog?.kind === "archiveParent" ? (
        dialog.parent.liveChildCount > 0 ? (
          <Modal
            title="Can't archive this product yet"
            onClose={() => setDialog(null)}
            footer={
              <button type="button" onClick={() => setDialog(null)} className={secondaryButton}>
                Close
              </button>
            }
          >
            <p className="text-sm text-slate-700">
              {dialog.parent.name} contains {plural(dialog.parent.liveChildCount, "variant")}. Archiving it could hide records that are still in use.
            </p>
            <p className="mt-2 text-sm text-slate-700">Archive each variant, or move it to another product (Edit → Product), first.</p>
          </Modal>
        ) : (
          <Modal
            title={`Archive ${dialog.parent.name}?`}
            onClose={() => setDialog(null)}
            footer={
              <>
                <button type="button" onClick={() => setDialog(null)} className={secondaryButton}>
                  Cancel
                </button>
                <button type="button" disabled={pending} onClick={() => act(`/api/v1/catalog/parents/${dialog.parent.id}/archive`, `${dialog.parent.name} archived.`)} className={dangerButton}>
                  {pending ? "Archiving…" : "Archive"}
                </button>
              </>
            }
          >
            <p className="text-sm text-slate-700">It disappears from the active list. Nothing is deleted, and you can restore it from the Archived filter.</p>
          </Modal>
        )
      ) : null}

      {dialog?.kind === "archiveChild" ? (
        <Modal
          title={`Archive ${dialog.child.displayName}?`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" onClick={() => setDialog(null)} className={secondaryButton}>
                Cancel
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => act(`/api/v1/catalog/children/${dialog.child.id}/archive`, `${dialog.child.displayName} archived. Its history is unchanged.`, dialog.parent.id)}
                className={dangerButton}
              >
                {pending ? "Archiving…" : "Archive"}
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-700">
            It disappears from the active list and every product picker. Past receiving reports, adjustments and stock movements stay intact.
          </p>
          {dialog.child.totalUnits !== 0 ? (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              It still has {fmt(dialog.child.totalUnits)} on hand, so archiving will be refused. Bring it to zero with a Stock Adjustment first.
            </p>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}
