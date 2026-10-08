// Reads the client's wholesale price list (WHOLE SALE PRICE.xlsx layout) into
// Product -> Variant -> Unit -> Price. Pure: no database, no file access.
//
// Sheet layout (verified against the client's file, see
// docs/catalog-import/): column A = description; B = price per SACK,
// C = price per RIM; D/E/F are quantities headed "PCS": D = 1 (the sack),
// E = rims per sack, F = "PACK" — whose meaning differs by section and is
// NOT turned into a pack size. A row with text in A only, written in
// capitals, is a section header; a blank row ends the current section.
// Nothing is guessed: anything ambiguous becomes an issue on the row.

export type Cell = string | number | null;
export const SHEET_COLUMNS = ["A", "B", "C", "D", "E", "F"] as const;
export type SheetColumn = (typeof SHEET_COLUMNS)[number];

export interface SheetRow {
  rowNumber: number;
  cells: Record<SheetColumn, Cell>;
}

export interface ParsedItem {
  sourceRow: number;
  /** Section header exactly as written (trimmed); null after a blank line with no new header. */
  section: string | null;
  originalText: string;
  rawCells: Record<SheetColumn, Cell>;
  normalizedName: string;
  sackPrice: number | null;
  rimPrice: number | null;
  /** Column C when C × F equals the sack price — a price per piece, not per rim. */
  piecePrice: number | null;
  rimsPerSack: number | null;
  piecesPerSack: number | null;
  /** Column F when its meaning is unknown — kept for the record, never used as a pack size. */
  packColumn: number | null;
  issues: string[];
}

const isNum = (v: Cell): v is number => typeof v === "number" && Number.isFinite(v);
const blank = (v: Cell) => v === null || (typeof v === "string" && v.trim() === "");
const peso = (n: number) => `₱${n.toLocaleString("en-PH")}`;

const SPELLING: Record<string, string> = { meduim: "Medium", med: "Medium", alluminum: "Aluminum", trans: "Transparent", "c/w": "Colored/White" };
const KEEP_UPPER = new Set(["kks", "hps", "mbw", "kr", "ko", "ks", "pe", "cb", "hd", "xl", "xxl", "p-cup", "p-spag", "opec", "v1"]);

function normalizeWord(word: string): string {
  const lower = word.toLowerCase();
  if (SPELLING[lower]) return SPELLING[lower];
  if (KEEP_UPPER.has(lower)) return word.toUpperCase();
  if (/^[a-z]\d+$/i.test(word)) return word.toUpperCase(); // K9, O1
  if (/^\d/.test(word)) return lower.replace(/^(\d+)(d)$/, "$1D"); // 8oz, 5x10, 5D
  return lower
    .split("/")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("/");
}

/** Display name for a row or section: trimmed, single-spaced, title-cased, with known misspellings fixed. */
export function normalizeName(raw: string): string {
  return raw
    .replace(/[{}]/g, "")
    .trim()
    .split(/\s+/)
    .map(normalizeWord)
    .join(" ");
}

function isSectionHeader(row: SheetRow): boolean {
  const a = row.cells.A;
  if (typeof a !== "string" || a.trim() === "") return false;
  const rest = SHEET_COLUMNS.slice(1).every((c) => blank(row.cells[c]));
  return rest && a === a.toUpperCase();
}

/** Turns sheet rows (from the first data row on) into items, one per product line, each with its open issues. */
export function parsePriceListRows(rows: SheetRow[]): ParsedItem[] {
  const items: ParsedItem[] = [];
  let section: string | null = null;

  for (const row of rows) {
    const { A, B, C, D, E, F } = row.cells;
    if (blank(A)) {
      if (SHEET_COLUMNS.slice(1).every((c) => blank(row.cells[c]))) section = null;
      continue;
    }
    if (isSectionHeader(row)) {
      section = String(A).trim();
      continue;
    }

    const originalText = String(A);
    const issues: string[] = [];
    let sackPrice: number | null = isNum(B) ? B : null;
    let rimsPerSack: number | null = isNum(E) ? E : null;
    let rimPrice: number | null = isNum(C) ? C : null;
    let piecePrice: number | null = null;
    let piecesPerSack: number | null = null;
    let packColumn: number | null = isNum(F) ? F : null;

    if (typeof B === "string" && !blank(B)) {
      const m = B.trim().match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+)$/);
      if (m) {
        sackPrice = Number(m[1]);
        rimsPerSack ??= Number(m[2]);
        issues.push(`Sack price typed as text "${B.trim()}" — read as ${peso(sackPrice)} for ${m[2]} rims.`);
      } else {
        issues.push(`Sack price "${B.trim()}" is not a number — not imported.`);
      }
    }
    if (typeof C === "string" && !blank(C)) issues.push(`Rim price "${C.trim()}" is not a number — not imported.`);
    if (typeof F === "string" && !blank(F)) {
      const m = F.trim().match(/^(\d+)\s*pcs$/i);
      if (m) {
        piecesPerSack = Number(m[1]);
        issues.push(`Pack column typed as text "${F.trim()}" — read as ${m[1]} pieces per sack (recorded, not used for stock).`);
      } else {
        issues.push(`Pack column "${F.trim()}" is not a number — not imported.`);
      }
      packColumn = null;
    }

    if (sackPrice !== null && rimPrice !== null && rimsPerSack === null && packColumn !== null && Math.abs(sackPrice - rimPrice * packColumn) < 0.005) {
      piecePrice = rimPrice;
      piecesPerSack = packColumn;
      rimPrice = null;
      packColumn = null;
      issues.push(`Column C (${peso(piecePrice)}) × ${piecesPerSack} = the sack price, so it is treated as a price per piece, not per rim.`);
    }

    if (sackPrice !== null && rimPrice !== null && rimsPerSack !== null) {
      const rimsTotal = Math.round(rimPrice * rimsPerSack * 100) / 100;
      if (Math.abs(sackPrice - rimsTotal) >= 0.005) {
        const direction = sackPrice < rimsTotal ? "cheaper" : "more expensive";
        issues.push(`Sack ${peso(sackPrice)} ≠ ${rimsPerSack} rims × ${peso(rimPrice)} = ${peso(rimsTotal)} (sack is ${direction}) — bulk price or typo?`);
      }
    }
    if (sackPrice === null && rimPrice === null && piecePrice === null) issues.push("No prices at all — imported as Inactive.");
    else if (sackPrice === null) issues.push("No sack price — sold by the sack only after one is entered.");
    if (rimPrice === null && piecePrice === null && rimsPerSack !== null) issues.push(`${rimsPerSack} rims per sack but no rim price — sold by the sack only for now.`);
    if (packColumn !== null) issues.push(`Pack column value ${packColumn} — meaning not confirmed, not used.`);
    if (blank(D) && !(sackPrice === null && rimPrice === null && piecePrice === null)) issues.push("Sack quantity (column D) is blank.");
    if (/\b(meduim|med)\b/i.test(originalText)) issues.push('Spelling: "meduim"/"med" shown as "Medium".');

    items.push({
      sourceRow: row.rowNumber,
      section,
      originalText,
      rawCells: { A, B, C, D, E, F },
      normalizedName: normalizeName(originalText),
      sackPrice,
      rimPrice,
      piecePrice,
      rimsPerSack,
      piecesPerSack,
      packColumn,
      issues,
    });
  }
  return items;
}

// ── Plan ────────────────────────────────────────────────────────────────

export type ImportUnitCode = "SACK" | "RIM" | "PC";

export interface ProductAssignment {
  product: string;
  category: string;
}

export interface PlannedVariant {
  item: ParsedItem;
  name: string;
  sku: string;
  status: "ACTIVE" | "INACTIVE";
  prices: Array<{ unitCode: ImportUnitCode; price: number }>;
  /** "1 <unitCode> = baseQtyPerUnit base units" — imported PENDING, confirmed by two people on first delivery. */
  packSizes: Array<{ unitCode: ImportUnitCode; baseQtyPerUnit: number }>;
  /** Item issues plus anything the plan itself couldn't import. */
  issues: string[];
}

export interface PlannedProduct {
  name: string;
  category: string;
  baseUnitCode: ImportUnitCode;
  variants: PlannedVariant[];
}

export interface PriceListPlan {
  products: PlannedProduct[];
  /** Rows the plan could not make sellable at all — the grouping needs fixing before applying. */
  conflicts: string[];
}

const slug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[¼]/g, "1-4")
    .replace(/[½]/g, "1-2")
    .replace(/[¾]/g, "3-4")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Smallest unit any variant is priced in: rim, else piece, else sack. Stock is counted in it. */
function baseUnitFor(items: ParsedItem[]): ImportUnitCode {
  if (items.some((i) => i.rimPrice !== null)) return "RIM";
  if (items.some((i) => i.piecePrice !== null)) return "PC";
  return "SACK";
}

/** Groups items into products (via `assign`) and works out each variant's base unit, prices and pack sizes. */
export function planPriceListImport(items: ParsedItem[], assign: (item: ParsedItem) => ProductAssignment): PriceListPlan {
  const groups = new Map<string, { category: string; items: ParsedItem[] }>();
  for (const item of items) {
    const { product, category } = assign(item);
    const group = groups.get(product) ?? { category, items: [] };
    group.items.push(item);
    groups.set(product, group);
  }

  const usedSkus = new Set<string>();
  const conflicts: string[] = [];
  const products: PlannedProduct[] = [];

  for (const [name, group] of groups) {
    const baseUnitCode = baseUnitFor(group.items);
    const variants = group.items.map((item): PlannedVariant => {
      const issues = [...item.issues];
      const prices: PlannedVariant["prices"] = [];
      const packSizes: PlannedVariant["packSizes"] = [];

      if (baseUnitCode === "RIM") {
        if (item.rimPrice !== null) prices.push({ unitCode: "RIM", price: item.rimPrice });
        if (item.piecePrice !== null) issues.push(`Per-piece price ${peso(item.piecePrice)} not imported — this product counts stock in rims.`);
        if (item.sackPrice !== null) {
          if (item.rimsPerSack !== null) {
            packSizes.push({ unitCode: "SACK", baseQtyPerUnit: item.rimsPerSack });
            prices.push({ unitCode: "SACK", price: item.sackPrice });
          } else {
            issues.push(`Sack price ${peso(item.sackPrice)} not imported — rims per sack unknown.`);
          }
        }
      } else if (baseUnitCode === "PC") {
        if (item.piecePrice !== null) prices.push({ unitCode: "PC", price: item.piecePrice });
        if (item.sackPrice !== null) {
          if (item.piecesPerSack !== null) {
            packSizes.push({ unitCode: "SACK", baseQtyPerUnit: item.piecesPerSack });
            prices.push({ unitCode: "SACK", price: item.sackPrice });
          } else {
            issues.push(`Sack price ${peso(item.sackPrice)} not imported — pieces per sack unknown.`);
          }
        }
      } else if (item.sackPrice !== null) {
        prices.push({ unitCode: "SACK", price: item.sackPrice });
      }

      const hadPrice = item.sackPrice !== null || item.rimPrice !== null || item.piecePrice !== null;
      if (hadPrice && prices.length === 0) {
        conflicts.push(`Row ${item.sourceRow} "${item.originalText.trim()}" → ${name}: none of its prices fit the product's ${baseUnitCode} base unit.`);
      }

      let sku = slug(`${name} ${item.normalizedName}`).slice(0, 60).replace(/-$/, "");
      for (let n = 2; usedSkus.has(sku); n++) sku = `${sku.slice(0, 56)}-${n}`;
      usedSkus.add(sku);

      return { item, name: item.normalizedName, sku, status: prices.length > 0 ? "ACTIVE" : "INACTIVE", prices, packSizes, issues };
    });
    products.push({ name, category: group.category, baseUnitCode, variants });
  }
  return { products, conflicts };
}
