// How the client's WHOLE SALE PRICE.xlsx rows become products — Setup
// question 1 in docs/catalog-import/Product-Price-List-Decisions-with-Examples.pdf
// (recommended option A, approved 2026-10-08, pending the client's own
// answers). Edit here, re-run the import with --dry-run, then apply.
//
// Default: each spreadsheet section is one product and its rows are the
// variants. Exceptions:
//  - UTENSILS is a mixed list (tape, gloves, foil…), so it is split into
//    real products below; anything not listed becomes its own product.
//  - A product counts stock in one unit, so two sections that mix
//    rim-priced and sack-only items are split along that line.
//  - Rows after a blank line with no header become their own products.
import { normalizeName, type ParsedItem, type ProductAssignment } from "../src/server/domain/catalog/priceListImport";

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

const UTENSILS: Record<string, string> = {
  "styro spag box": "Styro Food Box",
  "2 n 1": "Styro Food Box",
  "3 n 1": "Styro Food Box",
  "4 n 1": "Styro Food Box",
  "plain styro box": "Styro Food Box",
  "p-spag box": "P-Spag Box",
  "paper plate silver": "Paper Plate",
  "paper plate white": "Paper Plate",
  "paper plate small": "Paper Plate",
  spoon: "Spoon & Fork",
  fork: "Spoon & Fork",
  "opec fork": "Spoon & Fork",
  "opec spoon": "Spoon & Fork",
  "toy spoon": "Spoon & Fork",
  "sago straw": "Straw",
  "100g straw": "Straw",
  "40g straw": "Straw",
  "bending straw": "Straw",
  "1 kilo tali": "Tali",
  "500m tali": "Tali",
  "1000m tali": "Tali",
  "table napkin": "Tissue & Napkin",
  tissue: "Tissue & Napkin",
  "mbw small": "MBW",
  "mbw large": "MBW",
  "small jar": "Jar",
  "medium jar": "Jar",
  "large jar": "Jar",
  "2700-44 alluminum tray": "Aluminum Tray",
  "4920-64 alluminum tray": "Aluminum Tray",
  "5m foil": "Foil",
  "8m foil": "Foil",
};

/** Row text -> product, for sections split because they mix rim-priced and sack-only items. */
const UNIT_SPLITS: Record<string, Record<string, string>> = {
  "MILK TEA CUPS": { "12 oz dabba": "Dabba Cup", "16 oz dabba": "Dabba Cup" },
  "TRASH BAG": { "18½x18½x40 trash bag": "Trash Bag (by Rim)", "13x13x11 trash bag": "Trash Bag (by Rim)" },
};

/** The product and category each spreadsheet row is imported under. */
export function assignProduct(item: ParsedItem): ProductAssignment {
  if (item.section === null) return { product: item.normalizedName, category: "Others" };
  const sectionName = normalizeName(item.section);
  const rowKey = key(item.originalText);
  if (item.section === "UTENSILS") return { product: UTENSILS[rowKey] ?? item.normalizedName, category: sectionName };
  const split = UNIT_SPLITS[item.section]?.[rowKey];
  return { product: split ?? sectionName, category: sectionName };
}
