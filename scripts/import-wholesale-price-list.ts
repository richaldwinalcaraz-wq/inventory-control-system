// Imports the client's wholesale price list (WHOLE SALE PRICE.xlsx) into the
// catalog: Product -> Variant -> Unit -> Price, with pack sizes left PENDING
// until two people confirm them on first delivery. See
// src/server/domain/catalog/priceListImport.ts for how the sheet is read and
// scripts/price-list-grouping.ts for how rows become products.
//
//   npm run db:import-price-list -- "<path to xlsx>" --dry-run
//   npm run db:import-price-list -- "<path to xlsx>" [--owner <username>]
//
// The same file can only be imported once (matched by SHA-256), and the run
// refuses to touch any product name that already exists.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";
import { parsePriceListRows, planPriceListImport, SHEET_COLUMNS, type Cell, type SheetRow } from "../src/server/domain/catalog/priceListImport";
import { applyPriceListImport } from "../src/server/application/catalog/importPriceList";
import { assignProduct } from "./price-list-grouping";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ownerFlag = args.indexOf("--owner");
const OWNER_USERNAME = ownerFlag >= 0 ? args[ownerFlag + 1] : undefined;
const FILE = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--owner");

function cellValue(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "object" && "result" in value) return cellValue(value.result as ExcelJS.CellValue);
  if (typeof value === "object" && "richText" in value) return value.richText.map((t) => t.text).join("");
  if (typeof value === "object" && "text" in value) return String(value.text);
  return String(value);
}

async function readSheet(file: string): Promise<SheetRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("The workbook has no sheets.");
  const header = ["B", "C", "D", "E", "F"].map((c) => String(cellValue(sheet.getCell(`${c}3`).value) ?? "").trim().toUpperCase());
  if (header.join(",") !== "SACK,RIM,SACK,RIM,PACK") {
    throw new Error(`Row 3 should read SACK, RIM, SACK, RIM, PACK in columns B–F but reads ${header.join(", ")} — the layout changed, so nothing was imported.`);
  }
  const rows: SheetRow[] = [];
  for (let r = 4; r <= sheet.rowCount; r++) {
    const cells = Object.fromEntries(SHEET_COLUMNS.map((c) => [c, cellValue(sheet.getCell(`${c}${r}`).value)])) as SheetRow["cells"];
    rows.push({ rowNumber: r, cells });
  }
  return rows;
}

async function main() {
  if (!FILE) throw new Error('Usage: npm run db:import-price-list -- "<path to xlsx>" [--dry-run] [--owner <username>]');
  const sha256 = createHash("sha256").update(readFileSync(FILE)).digest("hex");
  const items = parsePriceListRows(await readSheet(FILE));
  const plan = planPriceListImport(items, assignProduct);

  console.log(`${basename(FILE)} — ${items.length} items, ${plan.products.length} products, sha256 ${sha256.slice(0, 12)}…\n`);
  console.table(
    plan.products.map((p) => ({
      product: p.name,
      category: p.category,
      stockUnit: p.baseUnitCode,
      variants: p.variants.length,
      inactive: p.variants.filter((v) => v.status === "INACTIVE").length,
      withIssues: p.variants.filter((v) => v.issues.length > 0).length,
    })),
  );
  const variants = plan.products.flatMap((p) => p.variants);
  console.log(
    `Prices: ${variants.reduce((n, v) => n + v.prices.length, 0)} · pending pack sizes: ${variants.reduce((n, v) => n + v.packSizes.length, 0)} · rows with open questions: ${variants.filter((v) => v.issues.length).length}`,
  );
  if (plan.conflicts.length > 0) {
    console.log(`\nCONFLICTS — fix scripts/price-list-grouping.ts before applying:\n  ${plan.conflicts.join("\n  ")}`);
    process.exitCode = 1;
    return;
  }

  if (DRY_RUN) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  const owner = await prisma.user.findFirstOrThrow({
    where: { role: "OWNER", status: "ACTIVE", ...(OWNER_USERNAME ? { username: OWNER_USERNAME } : {}) },
    orderBy: { createdAt: "asc" },
  });
  const summary = await applyPriceListImport(prisma, { actorRole: "OWNER", actorUserId: owner.id, sourceFile: basename(FILE), sourceSha256: sha256, plan });
  console.log(`\nImported as ${owner.username}:`);
  console.table([summary]);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
