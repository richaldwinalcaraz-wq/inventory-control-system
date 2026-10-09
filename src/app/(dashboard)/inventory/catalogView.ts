import { formatVariation } from "@/lib/variation";

// Pure shaping of the Product -> Variant folder view: search, filters and
// product-level roll-ups. No database access, so it is unit-testable.

export type CatalogStatusFilter = "live" | "ACTIVE" | "INACTIVE" | "ARCHIVED";
export type CatalogViewMode = "parents" | "children";

export interface CatalogFilters {
  q: string;
  view: CatalogViewMode;
  status: CatalogStatusFilter;
  brand: string;
  categoryId: string;
}

/** One selling unit as the list shows it: "Sack ₱4,000.00 (40 RIM)". */
export interface CatalogUnitSummary {
  unitId: string;
  code: string;
  name: string;
  /** Current all-branch WHOLESALE price. */
  price: string | null;
  /** Current all-branch RETAIL price. */
  retailPrice: string | null;
  /** Base units in one of this unit; null while the pack size awaits its two checks. */
  baseQtyPerUnit: number | null;
  pendingBaseQty: number | null;
  isBaseUnit: boolean;
}

export interface CatalogChildInput {
  id: string;
  asin: string | null;
  sku: string;
  name: string | null;
  variationData: unknown;
  units?: CatalogUnitSummary[];
  barcode: string | null;
  notes: string | null;
  status: string;
}

export interface CatalogParentInput {
  id: string;
  asin: string | null;
  name: string;
  sku: string | null;
  brand: string | null;
  categoryId: string | null;
  categoryName: string | null;
  description: string | null;
  notes: string | null;
  status: string;
  baseUnitId: string;
  baseUnitCode: string;
  children: CatalogChildInput[];
}

export interface CatalogChildRow extends CatalogChildInput {
  displayName: string;
  variation: string;
  byBranch: Record<string, number>;
  totalUnits: number;
  matched: boolean;
}

export interface CatalogParentRow extends Omit<CatalogParentInput, "children"> {
  children: CatalogChildRow[];
  /** Non-archived variants — what "contains N variants" means everywhere. */
  liveChildCount: number;
  /** Units on hand across every child and branch; never mixes in another parent's children. */
  totalUnits: number;
  /** True when the search matched a child (not the parent itself) — the folder opens to show it. */
  expandedBySearch: boolean;
}

export function parseCatalogFilters(raw: Record<string, string | undefined>): CatalogFilters {
  const status = raw.status;
  return {
    q: (raw.q ?? "").trim(),
    view: raw.view === "children" ? "children" : "parents",
    status: status === "ACTIVE" || status === "INACTIVE" || status === "ARCHIVED" ? status : "live",
    brand: (raw.brand ?? "").trim(),
    categoryId: (raw.category ?? "").trim(),
  };
}

function statusMatches(status: string, filter: CatalogStatusFilter): boolean {
  return filter === "live" ? status !== "ARCHIVED" : status === filter;
}

const includes = (value: string | null | undefined, q: string) => !!value && value.toLowerCase().includes(q);

/** Builds the folder rows. stockByVariant maps productVariantId -> branchId -> units on hand. */
export function buildCatalogView(
  parents: CatalogParentInput[],
  stockByVariant: Map<string, Record<string, number>>,
  filters: CatalogFilters,
): CatalogParentRow[] {
  const q = filters.q.toLowerCase();
  const rows: CatalogParentRow[] = [];

  for (const parent of parents) {
    if (filters.brand && (parent.brand ?? "").toLowerCase() !== filters.brand.toLowerCase()) continue;
    if (filters.categoryId && parent.categoryId !== filters.categoryId) continue;

    const allChildren: CatalogChildRow[] = parent.children.map((c) => {
      const byBranch = stockByVariant.get(c.id) ?? {};
      return {
        ...c,
        displayName: c.name ?? parent.name,
        variation: formatVariation(c.variationData),
        byBranch,
        totalUnits: Object.values(byBranch).reduce((sum, n) => sum + n, 0),
        matched: false,
      };
    });

    const parentMatchesSearch = !q || [parent.asin, parent.sku, parent.name, parent.brand].some((v) => includes(v, q));
    let children = allChildren.filter((c) => statusMatches(c.status, filters.status));
    let expandedBySearch = false;

    if (q && !parentMatchesSearch) {
      children = children
        .filter((c) => [c.asin, c.sku, c.name, c.displayName].some((v) => includes(v, q)))
        .map((c) => ({ ...c, matched: true }));
      if (children.length === 0) continue;
      expandedBySearch = true;
    } else if (!statusMatches(parent.status, filters.status) && children.length === 0) {
      continue;
    }

    rows.push({
      ...parent,
      children,
      liveChildCount: allChildren.filter((c) => c.status !== "ARCHIVED").length,
      totalUnits: allChildren.reduce((sum, c) => sum + c.totalUnits, 0),
      expandedBySearch,
    });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
