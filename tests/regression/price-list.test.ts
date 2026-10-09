// Product -> Variant -> Unit -> Price: the client's wholesale price list
// (docs/catalog-import/), per-unit prices with history, and pack sizes that
// only count after two independent physical checks.
import { createHash } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { normalizeName, parsePriceListRows, planPriceListImport, type Cell, type ParsedItem, type SheetRow } from "../../src/server/domain/catalog/priceListImport";
import { applyPriceListImport, PriceListImportRejectedError } from "../../src/server/application/catalog/importPriceList";
import { getSellingUnits, quoteLine, NoPriceForUnitError, PackSizeNotConfirmedError } from "../../src/server/domain/catalog/pricing";
import { addSellingUnit, confirmPackSize, proposePackSize, rejectPackSize, removeVariantPrice, setVariantPrice, PackSizeRequiredError } from "../../src/server/application/catalog/sellingUnits";
import { getProductMaster } from "../../src/server/application/catalog/productMaster";
import { draftRetailSale } from "../../src/server/application/retail/draft";
import { createParentAsin } from "../../src/server/application/catalog/parentAsins";
import { addChildAsin } from "../../src/server/application/catalog/childAsins";
import { ConversionRateVerificationError } from "../../src/server/domain/catalog/conversionRate";
import { PermissionDeniedError } from "../../src/server/domain/rbac/assertPermission";
import { getIloBranch, getUserByRole } from "./helpers/receiving";

const prisma = new PrismaClient();
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

afterAll(async () => {
  await prisma.$disconnect();
});

let rowNo = 3;
/** One sheet row, columns A–F, numbered like the client's file. */
const row = (...cells: Cell[]): SheetRow => {
  rowNo += 1;
  const [A = null, B = null, C = null, D = null, E = null, F = null] = cells;
  return { rowNumber: rowNo, cells: { A, B, C, D, E, F } };
};

// Rows copied verbatim from WHOLE SALE PRICE.xlsx.
const SHEET: SheetRow[] = [
  row("SANDO BAG "),
  row("K9 tiny white/colored", 4000, 100, 1, 40, 10),
  row("mercury meduim ", 7200, 600, 1, 12, 10),
  row("mercury large green", 8840, 1105, 1, 12, 10),
  row("SUPOT"),
  row("supot 1", 3200, 40, 1, 80, 100),
  row("supot 25"),
  row("CUPS"),
  row("2 oz colored", 250, null, 1, 20, 50),
  row("UTENSILS"),
  row("spoon fork tissue set", 2250, 4.5, 1, null, 500),
  row("MILK TEA CUPS"),
  row("Y CUP 12OZ WITH LIDS", 4250, null, 1, null, "2000PCS"),
  row("COUNTER BAG"),
  row("Cb #3 ", "5850/30", 195, 1, 30, 10),
  row(null),
  row("BALDE", null, 60),
];
const item = (text: string) => parsePriceListRows(SHEET).find((i) => i.originalText.trim() === text)!;

describe("Price list — reading the client's sheet", () => {
  it("[parse] K9 Tiny: sack ₱4,000 = 40 rims × ₱100; the PACK column is recorded but never used as a size", () => {
    const k9 = item("K9 tiny white/colored");
    expect(k9).toMatchObject({ section: "SANDO BAG", sackPrice: 4000, rimPrice: 100, rimsPerSack: 40, packColumn: 10, piecePrice: null, normalizedName: "K9 Tiny White/Colored" });
    expect(k9.issues.some((i) => i.includes("≠"))).toBe(false);
    expect(k9.issues.some((i) => i.includes("Pack column value 10"))).toBe(true);
  });

  it("[parse] flags a sack price that doesn't equal rims × rim price instead of trusting either number", () => {
    expect(item("mercury large green").issues.join(" ")).toContain("₱13,260");
  });

  it("[parse] keeps the original text and fixes spelling only in the display name", () => {
    const m = item("mercury meduim");
    expect(m.originalText).toBe("mercury meduim ");
    expect(m.normalizedName).toBe("Mercury Medium");
    expect(normalizeName("  {CALIPSO} ")).toBe("Calipso");
  });

  it("[parse] reads C as a per-piece price when C × F equals the sack price", () => {
    expect(item("spoon fork tissue set")).toMatchObject({ piecePrice: 4.5, piecesPerSack: 500, rimPrice: null });
  });

  it("[parse] reads text cells '5850/30' and '2000PCS' and says so", () => {
    expect(item("Cb #3")).toMatchObject({ sackPrice: 5850, rimsPerSack: 30 });
    expect(item("Cb #3").issues[0]).toContain("typed as text");
    expect(item("Y CUP 12OZ WITH LIDS")).toMatchObject({ piecesPerSack: 2000, packColumn: null });
  });

  it("[parse] capital rows are headers, a lowercase row with no values is an item, a blank row ends the section", () => {
    expect(item("supot 25")).toMatchObject({ section: "SUPOT", sackPrice: null, rimPrice: null });
    expect(item("supot 25").issues).toContain("No prices at all — imported as Inactive.");
    expect(item("BALDE").section).toBeNull();
  });

  it("[plan] rim products count stock in rims with a pending 40-rim sack; sack-only products count in sacks; per-piece products in pieces", () => {
    const plan = planPriceListImport(parsePriceListRows(SHEET), (i) => ({ product: i.section ?? i.normalizedName, category: "Test" }));
    const byName = new Map(plan.products.map((p) => [p.name, p]));
    expect(plan.conflicts).toEqual([]);
    const sando = byName.get("SANDO BAG")!;
    expect(sando.baseUnitCode).toBe("RIM");
    expect(sando.variants[0]).toMatchObject({ prices: [{ unitCode: "RIM", price: 100 }, { unitCode: "SACK", price: 4000 }], packSizes: [{ unitCode: "SACK", baseQtyPerUnit: 40 }] });
    expect(byName.get("CUPS")).toMatchObject({ baseUnitCode: "SACK", variants: [{ prices: [{ unitCode: "SACK", price: 250 }], packSizes: [] }] });
    expect(byName.get("UTENSILS")).toMatchObject({ baseUnitCode: "PC", variants: [{ packSizes: [{ unitCode: "SACK", baseQtyPerUnit: 500 }] }] });
    expect(byName.get("SUPOT")!.variants.find((v) => v.name === "Supot 25")!.status).toBe("INACTIVE");
  });

  it("[plan] reports a product mixing rim-priced items with sack-only items it can't convert, instead of dropping prices silently", () => {
    const items = parsePriceListRows([row("MIXED"), row("12 oz dabba", 4750, 190, 1, 25, 50), row("Y CUP 16 OZ WITH LIDS", 4500, null, 1, null, "2000PCS")]);
    const plan = planPriceListImport(items, () => ({ product: "Mixed", category: "Test" }));
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toContain("Y CUP 16 OZ WITH LIDS");
  });
});

/** Imports the K9 Tiny + Cups rows under unique product names and returns the variants. */
async function importSample() {
  const tag = uniq();
  const owner = await getUserByRole(prisma, "owner");
  const items = parsePriceListRows(SHEET).filter((i) => ["K9 tiny white/colored", "2 oz colored", "mercury meduim ", "mercury large green"].includes(i.originalText));
  const plan = planPriceListImport(items, (i: ParsedItem) => ({ product: `${normalizeName(i.section ?? "x")} ${tag}`, category: `Test Import ${tag}` }));
  const sha = createHash("sha256").update(tag).digest("hex");
  const summary = await applyPriceListImport(prisma, { actorRole: "OWNER", actorUserId: owner.id, sourceFile: `test-${tag}.xlsx`, sourceSha256: sha, plan });
  const k9 = await prisma.productVariant.findFirstOrThrow({ where: { name: "K9 Tiny White/Colored", product: { name: `Sando Bag ${tag}` } }, include: { product: true } });
  const units = Object.fromEntries((await prisma.unitOfMeasure.findMany({ where: { code: { in: ["SACK", "RIM", "PACK"] } } })).map((u) => [u.code, u.id]));
  return { tag, sha, plan, summary, owner, k9, units };
}

describe("Price list — import, prices and pack sizes", () => {
  it("[import] creates products, priced variants and PENDING pack sizes, keeps every original row, and refuses a second run", async () => {
    const { tag, sha, plan, summary, owner, k9 } = await importSample();
    expect(summary).toMatchObject({ products: 2, variants: 4, prices: 7, pendingPackSizes: 3 });

    const row = await prisma.catalogImportRow.findFirstOrThrow({ where: { productVariantId: k9.id } });
    expect(row.originalText).toBe("K9 tiny white/colored");
    expect(row.rawCells).toMatchObject({ B: 4000, C: 100, E: 40, F: 10 });
    const pack = await prisma.conversionRateVersion.findFirstOrThrow({ where: { productVariantId: k9.id } });
    expect(pack).toMatchObject({ status: "PENDING_VERIFICATION", proposedBy: owner.id });
    expect(Number(pack.rate)).toBe(40);

    await expect(applyPriceListImport(prisma, { actorRole: "OWNER", actorUserId: owner.id, sourceFile: "again.xlsx", sourceSha256: sha, plan })).rejects.toThrow("already been imported");
    await expect(
      applyPriceListImport(prisma, { actorRole: "OWNER", actorUserId: owner.id, sourceFile: "clash.xlsx", sourceSha256: createHash("sha256").update(`clash-${tag}`).digest("hex"), plan }),
    ).rejects.toThrow(PriceListImportRejectedError);
  });

  it("[sell] a rim is sellable at once; the sack is priced but not sellable until two other people confirm 40 rims", async () => {
    const { k9, units } = await importSample();
    const rimQuote = await quoteLine(prisma, { productVariantId: k9.id, unitId: units.RIM!, quantity: 10 });
    expect(rimQuote).toMatchObject({ unitPrice: "100.00", lineTotal: "1000.00", baseQuantity: "10" });
    await expect(quoteLine(prisma, { productVariantId: k9.id, unitId: units.SACK!, quantity: 1 })).rejects.toThrow(PackSizeNotConfirmedError);

    const sack = (await getSellingUnits(prisma, [k9.id])).get(k9.id)!.find((u) => u.unitCode === "SACK")!;
    expect(sack).toMatchObject({ sellable: false, baseQtyPerUnit: null, price: { amount: "4000.00" } });
  });

  it("[check] the proposer can't confirm; Secretary then Encoder confirm; a person can't count twice; then sacks sell", async () => {
    const { k9, units, owner } = await importSample();
    const [secretary, encoder] = await Promise.all([getUserByRole(prisma, "secretary"), getUserByRole(prisma, "encoder")]);
    const pack = await prisma.conversionRateVersion.findFirstOrThrow({ where: { productVariantId: k9.id, status: "PENDING_VERIFICATION" } });

    await expect(confirmPackSize(prisma, { actorRole: "OWNER", actorUserId: owner.id, conversionRateVersionId: pack.id })).rejects.toThrow(ConversionRateVerificationError);
    expect((await confirmPackSize(prisma, { actorRole: "SECRETARY", actorUserId: secretary.id, conversionRateVersionId: pack.id })).status).toBe("PENDING_VERIFICATION");
    await expect(confirmPackSize(prisma, { actorRole: "SECRETARY", actorUserId: secretary.id, conversionRateVersionId: pack.id })).rejects.toThrow(ConversionRateVerificationError);
    expect((await confirmPackSize(prisma, { actorRole: "ENCODER", actorUserId: encoder.id, conversionRateVersionId: pack.id })).status).toBe("ACTIVE");

    expect(await quoteLine(prisma, { productVariantId: k9.id, unitId: units.SACK!, quantity: 2 })).toMatchObject({ unitPrice: "4000.00", lineTotal: "8000.00", baseQuantity: "80", conversionRateVersionId: pack.id });
    const actions = (await prisma.auditLog.findMany({ where: { entityId: k9.id, action: { startsWith: "catalog.pack_size." } } })).map((a) => a.action).sort();
    expect(actions).toEqual(["catalog.pack_size.activated", "catalog.pack_size.checked"]);
  });

  it("[check] a different count rejects the size and records what was counted", async () => {
    const { k9 } = await importSample();
    const secretary = await getUserByRole(prisma, "secretary");
    const pack = await prisma.conversionRateVersion.findFirstOrThrow({ where: { productVariantId: k9.id, status: "PENDING_VERIFICATION" } });
    await rejectPackSize(prisma, { actorRole: "SECRETARY", actorUserId: secretary.id, conversionRateVersionId: pack.id, countedBaseQty: 38, note: "Short 2 rims" });
    expect((await prisma.conversionRateVersion.findUniqueOrThrow({ where: { id: pack.id } })).status).toBe("REJECTED");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: k9.id, action: "catalog.pack_size.rejected" } });
    expect(audit.afterState).toMatchObject({ countedBaseQty: 38, note: "Short 2 rims" });
  });

  it("[check] confirming a NEW sack size clears the sack's old prices on every list and branch; the first size and the rim keep theirs", async () => {
    const { k9, units, owner } = await importSample();
    const [secretary, encoder, ilo] = await Promise.all([getUserByRole(prisma, "secretary"), getUserByRole(prisma, "encoder"), getIloBranch(prisma)]);
    const actor = { actorRole: "OWNER" as const, actorUserId: owner.id };
    const confirmTwice = async (id: string) => {
      await confirmPackSize(prisma, { actorRole: "SECRETARY", actorUserId: secretary.id, conversionRateVersionId: id });
      return confirmPackSize(prisma, { actorRole: "ENCODER", actorUserId: encoder.id, conversionRateVersionId: id });
    };
    const first = await prisma.conversionRateVersion.findFirstOrThrow({ where: { productVariantId: k9.id, status: "PENDING_VERIFICATION" } });
    expect((await confirmTwice(first.id)).pricesCleared).toBe(0);
    expect((await quoteLine(prisma, { productVariantId: k9.id, unitId: units.SACK!, quantity: 1 })).unitPrice).toBe("4000.00");

    await setVariantPrice(prisma, { ...actor, productVariantId: k9.id, unitId: units.SACK!, priceList: "RETAIL", price: 4500 });
    await setVariantPrice(prisma, { ...actor, productVariantId: k9.id, unitId: units.SACK!, price: 3900, branchId: ilo.id });
    const bigger = await proposePackSize(prisma, { ...actor, productVariantId: k9.id, unitId: units.SACK!, baseQtyPerUnit: 50 });
    // While the new size waits for checks, the old size and its price still sell.
    expect((await quoteLine(prisma, { productVariantId: k9.id, unitId: units.SACK!, quantity: 1 })).baseQuantity).toBe("40");

    expect((await confirmTwice(bigger.id)).pricesCleared).toBe(3);
    await expect(quoteLine(prisma, { productVariantId: k9.id, unitId: units.SACK!, quantity: 1 })).rejects.toThrow(NoPriceForUnitError);
    await expect(quoteLine(prisma, { productVariantId: k9.id, unitId: units.SACK!, quantity: 1, priceList: "RETAIL", branchId: ilo.id })).rejects.toThrow(NoPriceForUnitError);
    expect((await quoteLine(prisma, { productVariantId: k9.id, unitId: units.RIM!, quantity: 1 })).unitPrice).toBe("100.00");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: k9.id, action: "catalog.price.removed" } });
    expect(audit.afterState).toMatchObject({ unit: "SACK", reason: "pack_size_changed", oldRate: 40, newRate: 50 });

    await setVariantPrice(prisma, { ...actor, productVariantId: k9.id, unitId: units.SACK!, price: 5000 });
    expect(await quoteLine(prisma, { productVariantId: k9.id, unitId: units.SACK!, quantity: 1 })).toMatchObject({ unitPrice: "5000.00", baseQuantity: "50" });
  });

  it("[price] a price change keeps the old price as history; new quotes use the new price; base price syncs the legacy field", async () => {
    const { k9, units, owner } = await importSample();
    await setVariantPrice(prisma, { actorRole: "OWNER", actorUserId: owner.id, productVariantId: k9.id, unitId: units.RIM!, price: 110 });

    const rows = await prisma.variantPrice.findMany({ where: { productVariantId: k9.id, unitId: units.RIM! }, orderBy: { effectiveFrom: "asc" } });
    expect(rows.map((r) => [r.price.toFixed(2), r.supersededAt === null])).toEqual([
      ["100.00", false],
      ["110.00", true],
    ]);
    expect((await quoteLine(prisma, { productVariantId: k9.id, unitId: units.RIM!, quantity: 10 })).lineTotal).toBe("1100.00");
    expect(Number((await prisma.productVariant.findUniqueOrThrow({ where: { id: k9.id } })).sellingPrice)).toBe(110);
  });

  it("[price] parallel price changes leave exactly one current price", async () => {
    const { k9, units, owner } = await importSample();
    await Promise.all([101, 102, 103, 104, 105].map((price) => setVariantPrice(prisma, { actorRole: "OWNER", actorUserId: owner.id, productVariantId: k9.id, unitId: units.RIM!, price })));
    expect(await prisma.variantPrice.count({ where: { productVariantId: k9.id, unitId: units.RIM!, supersededAt: null } })).toBe(1);
    expect(await prisma.variantPrice.count({ where: { productVariantId: k9.id, unitId: units.RIM! } })).toBe(6);
  });

  it("[price] retail and wholesale prices are separate: setting or removing retail never touches wholesale or the legacy price", async () => {
    const { k9, units, owner } = await importSample();
    const actor = { actorRole: "OWNER" as const, actorUserId: owner.id };
    await setVariantPrice(prisma, { ...actor, productVariantId: k9.id, unitId: units.RIM!, priceList: "RETAIL", price: 120 });
    await setVariantPrice(prisma, { ...actor, productVariantId: k9.id, unitId: units.SACK!, priceList: "RETAIL", price: 4500 });

    expect((await quoteLine(prisma, { productVariantId: k9.id, unitId: units.RIM!, quantity: 2, priceList: "RETAIL" })).lineTotal).toBe("240.00");
    expect((await quoteLine(prisma, { productVariantId: k9.id, unitId: units.RIM!, quantity: 2 })).lineTotal).toBe("200.00");
    expect(Number((await prisma.productVariant.findUniqueOrThrow({ where: { id: k9.id } })).sellingPrice)).toBe(100);
    const retailSack = (await getSellingUnits(prisma, [k9.id], { priceList: "RETAIL" })).get(k9.id)!.find((u) => u.unitCode === "SACK")!;
    expect(retailSack).toMatchObject({ price: { amount: "4500.00" }, sellable: false });

    await removeVariantPrice(prisma, { ...actor, productVariantId: k9.id, unitId: units.RIM!, priceList: "RETAIL" });
    await expect(quoteLine(prisma, { productVariantId: k9.id, unitId: units.RIM!, quantity: 1, priceList: "RETAIL" })).rejects.toThrow(NoPriceForUnitError);
    expect((await quoteLine(prisma, { productVariantId: k9.id, unitId: units.RIM!, quantity: 1 })).unitPrice).toBe("100.00");
  });

  it("[sell] a retail sale charges the RETAIL price, and an item with no retail price is refused instead of sold at ₱0", async () => {
    const { k9, units, owner } = await importSample();
    const [cashier, ilo] = await Promise.all([getUserByRole(prisma, "cashier"), getIloBranch(prisma)]);
    const sale = (lines: Array<{ productVariantId: string; quantity: number }>) => draftRetailSale(prisma, { actorUserId: cashier.id, actorRole: "CASHIER", branchId: ilo.id, lines });

    await expect(sale([{ productVariantId: k9.id, quantity: 2 }])).rejects.toThrow(NoPriceForUnitError);
    await setVariantPrice(prisma, { actorRole: "OWNER", actorUserId: owner.id, productVariantId: k9.id, unitId: units.RIM!, priceList: "RETAIL", price: 120 });
    const drafted = await sale([{ productVariantId: k9.id, quantity: 2 }]);
    expect(Number(drafted.lines[0]!.unitPrice)).toBe(120);
  });

  it("[unit] adding a unit with a retail price saves size, wholesale and retail together — or none of them", async () => {
    const { k9, units, owner } = await importSample();
    const actor = { actorRole: "OWNER" as const, actorUserId: owner.id };
    await addSellingUnit(prisma, { ...actor, productVariantId: k9.id, unitId: units.PACK!, baseQtyPerUnit: 0.1, price: 12, retailPrice: 15 });
    const pack = (await getSellingUnits(prisma, [k9.id])).get(k9.id)!.find((u) => u.unitCode === "PACK")!;
    expect([pack.pricesByList.WHOLESALE?.amount, pack.pricesByList.RETAIL?.amount]).toEqual(["12.00", "15.00"]);

    const box = await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: "BOX" } });
    await expect(addSellingUnit(prisma, { ...actor, productVariantId: k9.id, unitId: box.id, baseQtyPerUnit: 5, price: 50, retailPrice: 0 })).rejects.toThrow();
    expect(await prisma.conversionRateVersion.count({ where: { productVariantId: k9.id, fromUnitId: box.id } })).toBe(0);
    expect(await prisma.variantPrice.count({ where: { productVariantId: k9.id, unitId: box.id } })).toBe(0);
  });

  it("[price] a branch price overrides the all-branch price only for that branch", async () => {
    const { k9, units, owner } = await importSample();
    const ilo = await getIloBranch(prisma);
    await setVariantPrice(prisma, { actorRole: "OWNER", actorUserId: owner.id, productVariantId: k9.id, unitId: units.RIM!, price: 95, branchId: ilo.id });
    expect((await quoteLine(prisma, { productVariantId: k9.id, unitId: units.RIM!, quantity: 1, branchId: ilo.id })).unitPrice).toBe("95.00");
    expect((await quoteLine(prisma, { productVariantId: k9.id, unitId: units.RIM!, quantity: 1 })).unitPrice).toBe("100.00");
  });

  it("[price] 'stop selling' retires a unit's price; pricing a unit with no size is refused; a new unit arrives pending", async () => {
    const { k9, units, owner } = await importSample();
    const actor = { actorRole: "OWNER" as const, actorUserId: owner.id };
    await removeVariantPrice(prisma, { ...actor, productVariantId: k9.id, unitId: units.RIM! });
    await expect(quoteLine(prisma, { productVariantId: k9.id, unitId: units.RIM!, quantity: 1 })).rejects.toThrow(NoPriceForUnitError);

    await expect(setVariantPrice(prisma, { ...actor, productVariantId: k9.id, unitId: units.PACK!, price: 12 })).rejects.toThrow(PackSizeRequiredError);
    await addSellingUnit(prisma, { ...actor, productVariantId: k9.id, unitId: units.PACK!, baseQtyPerUnit: 0.1, price: 12 });
    const pack = (await getSellingUnits(prisma, [k9.id])).get(k9.id)!.find((u) => u.unitCode === "PACK")!;
    expect(pack).toMatchObject({ sellable: false, pendingPackSize: { rate: 0.1 }, price: { amount: "12.00" } });
  });

  it("[rbac] only the Owner sets prices; Secretary and Encoder may only check sizes", async () => {
    const { k9, units } = await importSample();
    const secretary = await getUserByRole(prisma, "secretary");
    await expect(setVariantPrice(prisma, { actorRole: "SECRETARY", actorUserId: secretary.id, productVariantId: k9.id, unitId: units.RIM!, price: 1 })).rejects.toThrow(PermissionDeniedError);
    await expect(addSellingUnit(prisma, { actorRole: "ENCODER", actorUserId: secretary.id, productVariantId: k9.id, unitId: units.PACK!, baseQtyPerUnit: 5, price: 1 })).rejects.toThrow(PermissionDeniedError);
  });

  it("[master] the product master lists the imported product with its units, prices and stock", async () => {
    const { tag } = await importSample();
    const master = await getProductMaster(prisma);
    const sando = master.find((p) => p.name === `Sando Bag ${tag}`)!;
    expect(sando.baseUnit.code).toBe("RIM");
    // The client's row order, not A–Z (which would put Large Green before Medium).
    expect(sando.variants.map((v) => v.name)).toEqual(["K9 Tiny White/Colored", "Mercury Medium", "Mercury Large Green"]);
    const k9 = sando.variants.find((v) => v.name === "K9 Tiny White/Colored")!;
    expect(k9.onHandBase).toBe(0);
    expect(k9.sellingUnits.map((u) => [u.unitCode, u.price?.amount, u.sellable])).toEqual([
      ["SACK", "4000.00", false],
      ["RIM", "100.00", true],
    ]);
  });

  it("[asin] a product and variant can be created without an ASIN; the variant's first price is its base-unit price", async () => {
    const owner = await getUserByRole(prisma, "owner");
    const rim = await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: "RIM" } });
    const product = await createParentAsin(prisma, { actorRole: "OWNER", actorUserId: owner.id, productName: `No-ASIN Bag ${uniq()}`, baseUnitId: rim.id });
    const variant = await addChildAsin(prisma, { actorRole: "OWNER", actorUserId: owner.id, parentProductId: product.id, sku: `NOASIN-${uniq()}`, name: "Small", sellingPrice: 55 });
    expect(product.asin).toBeNull();
    expect(variant.asin).toBeNull();
    expect((await quoteLine(prisma, { productVariantId: variant.id, unitId: rim.id, quantity: 3 })).lineTotal).toBe("165.00");
  });
});
