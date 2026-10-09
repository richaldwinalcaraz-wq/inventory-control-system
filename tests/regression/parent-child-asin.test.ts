// Parent ASIN -> Child ASIN catalog (Product -> ProductVariant). One test per
// acceptance case in the feature spec (Tests 1-10), plus format/permission/
// move rules. Parent ASINs are folders; Child ASINs are the items inside.
import { randomBytes } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createParentAsin, updateParentAsin, archiveParentAsin, restoreParentAsin, ParentHasChildrenError } from "../../src/server/application/catalog/parentAsins";
import { addChildAsin, updateChildAsin, archiveChildAsin, ProductStillInUseError, IncompatibleParentError } from "../../src/server/application/catalog/childAsins";
import { ChildAsinExistsError, ParentAsinExistsError, InvalidAsinError, resolveAsin } from "../../src/server/domain/catalog/asin";
import { PermissionDeniedError } from "../../src/server/domain/rbac/assertPermission";
import { draftReceivingReport } from "../../src/server/application/receiving/draft";
import { submitReceiverCount, submitCheckerCount } from "../../src/server/application/receiving/counting";
import { submitInspection } from "../../src/server/application/receiving/inspection";
import { verifyReceivingReport } from "../../src/server/application/receiving/verification";
import { approveReceivingReport } from "../../src/server/application/receiving/approval";
import { encodeReceivingReport } from "../../src/server/application/receiving/encoding";
import { buildCatalogView, parseCatalogFilters, type CatalogParentInput } from "../../src/app/(dashboard)/inventory/catalogView";
import { PICKABLE_VARIANT_WHERE } from "../../src/lib/variation";
import { getUserByRole, getIloBranch, createSessionAndPin, SEED_SUPPLIER_ID } from "./helpers/receiving";

const prisma = new PrismaClient();
const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newAsin = () => "B0" + Array.from(randomBytes(8), (b) => ALNUM[b % ALNUM.length]).join("");
const newSku = (prefix: string) => `${prefix}-${randomBytes(4).toString("hex").toUpperCase()}`;

afterAll(async () => {
  await prisma.$disconnect();
});

async function ownerActor() {
  const owner = await getUserByRole(prisma, "owner");
  return { actorRole: "OWNER" as const, actorUserId: owner.id };
}

async function unitId(code: string) {
  return (await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code } })).id;
}

async function makeParent(name = "Example T-Shirt", baseUnit = "PC") {
  return createParentAsin(prisma, { ...(await ownerActor()), asin: newAsin(), productName: name, brand: "Example Brand", baseUnitId: await unitId(baseUnit) });
}

async function makeChild(parentId: string, variation: Record<string, string>) {
  return addChildAsin(prisma, { ...(await ownerActor()), parentProductId: parentId, asin: newAsin(), sku: newSku("TS"), sellingPrice: 250, variationData: variation });
}

/** The Owner may run every receiving step alone (three-role model); posts `qty` into the child. */
async function receiveIntoChild(productVariantId: string, qty: number) {
  const branch = await getIloBranch(prisma);
  const { actorUserId } = await ownerActor();
  const owner = { actorUserId, actorRole: "OWNER" as const };
  const rr = await draftReceivingReport(prisma, {
    ...owner,
    branchId: branch.id,
    supplierId: SEED_SUPPLIER_ID,
    drNumber: `DR-ASIN-${randomBytes(4).toString("hex")}`,
    poReference: `PO-ASIN-${randomBytes(4).toString("hex")}`,
    lines: [{ productVariantId, expectedQty: qty, unitCost: 40 }],
  });
  const lines = [{ productVariantId, countedQty: qty }];
  await submitReceiverCount(prisma, { rrId: rr.id, ...owner, lines });
  await submitCheckerCount(prisma, { rrId: rr.id, ...owner, lines });
  await submitInspection(prisma, { rrId: rr.id, ...owner, outcome: "PASS" });
  await verifyReceivingReport(prisma, { rrId: rr.id, ...owner });
  const a = await createSessionAndPin(prisma, actorUserId);
  await approveReceivingReport(prisma, { rrId: rr.id, ...owner, session: a.session, pinTokenId: a.pinToken.id });
  const e = await createSessionAndPin(prisma, actorUserId);
  await encodeReceivingReport(prisma, { rrId: rr.id, ...owner, branchCode: branch.code, session: e.session, pinTokenId: e.pinToken.id, evidencePhotos: [{ storageKey: `test:asin-${rr.id}.jpg`, captureMethod: "LIVE_CAMERA_STREAM" }] });
  return rr;
}

/** Loads catalog rows + live stock exactly the way the Inventory page does. */
async function loadCatalog(filters: Record<string, string>) {
  const [products, balances] = await Promise.all([
    prisma.product.findMany({ include: { baseUnit: { select: { code: true } }, category: { select: { name: true } }, variants: true } }),
    prisma.stockBalance.findMany({ select: { productVariantId: true, quantityOnHand: true, warehouseLocation: { select: { warehouse: { select: { branchId: true } } } } } }),
  ]);
  const stock = new Map<string, Record<string, number>>();
  for (const b of balances) {
    const row = stock.get(b.productVariantId) ?? {};
    const branchId = b.warehouseLocation.warehouse.branchId;
    row[branchId] = (row[branchId] ?? 0) + Number(b.quantityOnHand);
    stock.set(b.productVariantId, row);
  }
  const inputs: CatalogParentInput[] = products.map((p) => ({
    id: p.id, asin: p.asin, name: p.name, sku: p.sku, brand: p.brand, categoryId: p.categoryId, categoryName: p.category?.name ?? null,
    description: p.description, notes: p.notes, status: p.status, baseUnitId: p.baseUnitId, baseUnitCode: p.baseUnit.code,
    children: p.variants.map((v) => ({ id: v.id, asin: v.asin, sku: v.sku, name: v.name, variationData: v.variationData, barcode: v.barcode, notes: v.notes, status: v.status })),
  }));
  return buildCatalogView(inputs, stock, parseCatalogFilters(filters));
}

describe("Parent ASIN -> Child ASIN catalog", () => {
  it("Test 1: creates a Parent ASIN and logs it", async () => {
    const parent = await makeParent();
    expect(parent.asin).toMatch(/^B0[A-Z0-9]{8}$/);
    expect(parent.status).toBe("ACTIVE");
    const audit = await prisma.auditLog.findFirst({ where: { entityType: "Product", entityId: parent.id, action: "catalog.parent.created" } });
    expect(audit).not.toBeNull();
  });

  it("Test 2: a Child ASIN appears under its Parent, and the add is logged", async () => {
    const parent = await makeParent();
    const child = await makeChild(parent.id, { Size: "Small", Color: "Black" });
    expect(child.productId).toBe(parent.id);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "ProductVariant", entityId: child.id, action: "catalog.child.added" } });
    expect(audit.afterState).toMatchObject({ parentAsin: parent.asin, childAsin: child.asin });
  });

  it("Test 3: one Parent holds many Children", async () => {
    const parent = await makeParent();
    for (const v of [{ Size: "Small" }, { Size: "Medium" }, { Size: "Large" }, { Size: "XL" }]) await makeChild(parent.id, v);
    const [row] = await loadCatalog({ q: parent.asin! });
    expect(row?.id).toBe(parent.id);
    expect(row?.children.map((c) => c.variation).sort()).toEqual(["Large", "Medium", "Small", "XL"]);
    expect(row?.liveChildCount).toBe(4);
  });

  it("Test 4: searching a Child ASIN shows it inside its Parent", async () => {
    const parent = await makeParent();
    await makeChild(parent.id, { Size: "Small", Color: "Black" });
    const target = await makeChild(parent.id, { Size: "Large", Color: "Black" });

    const rows = await loadCatalog({ q: target.asin!.toLowerCase() });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(parent.id);
    expect(rows[0]!.expandedBySearch).toBe(true);
    expect(rows[0]!.children.map((c) => c.asin)).toEqual([target.asin]);
    expect(rows[0]!.children[0]!.variation).toBe("Large / Black");

    const resolved = await resolveAsin(prisma, target.asin!);
    expect(resolved).toMatchObject({ level: "CHILD", parent: { asin: parent.asin, productName: "Example T-Shirt" }, child: { asin: target.asin } });
  });

  it("Test 5: a duplicate Child ASIN is rejected — including one already used as a Parent", async () => {
    const parent = await makeParent();
    const child = await makeChild(parent.id, { Size: "Small" });
    const other = await makeParent("Other Product");
    const owner = await ownerActor();
    await expect(addChildAsin(prisma, { ...owner, parentProductId: other.id, asin: child.asin!, sku: newSku("DUP"), sellingPrice: 10 })).rejects.toThrow(ChildAsinExistsError);
    await expect(addChildAsin(prisma, { ...owner, parentProductId: other.id, asin: child.asin!, sku: newSku("DUP"), sellingPrice: 10 })).rejects.toThrow("Child ASIN already exists");
    await expect(addChildAsin(prisma, { ...owner, parentProductId: other.id, asin: parent.asin!, sku: newSku("DUP"), sellingPrice: 10 })).rejects.toThrow(ParentAsinExistsError);
  });

  it("Test 6: a duplicate Parent ASIN is rejected, regardless of letter case", async () => {
    const parent = await makeParent();
    const owner = await ownerActor();
    await expect(createParentAsin(prisma, { ...owner, asin: parent.asin!.toLowerCase(), productName: "Copy", baseUnitId: await unitId("PC") })).rejects.toThrow("Parent ASIN already exists");
  });

  it("Test 7: a Parent with live Children can't be archived; once they're archived it can, and it can be restored", async () => {
    const parent = await makeParent();
    const child = await makeChild(parent.id, { Size: "Small" });
    const owner = await ownerActor();

    await expect(archiveParentAsin(prisma, { ...owner, productId: parent.id })).rejects.toThrow(ParentHasChildrenError);
    await expect(archiveParentAsin(prisma, { ...owner, productId: parent.id })).rejects.toThrow("contains 1 variant");

    await archiveChildAsin(prisma, { ...owner, productVariantId: child.id });
    expect((await archiveParentAsin(prisma, { ...owner, productId: parent.id })).status).toBe("ARCHIVED");
    expect((await restoreParentAsin(prisma, { ...owner, productId: parent.id })).status).toBe("ACTIVE");
    expect(await prisma.product.count({ where: { id: parent.id } })).toBe(1);
  });

  it("Test 8: an archived Child leaves the active list and pickers, but its record and history stay", async () => {
    const parent = await makeParent();
    const keep = await makeChild(parent.id, { Size: "Small" });
    const gone = await makeChild(parent.id, { Size: "Medium" });
    await archiveChildAsin(prisma, { ...(await ownerActor()), productVariantId: gone.id });

    const [live] = await loadCatalog({ q: parent.asin! });
    expect(live!.children.map((c) => c.id)).toEqual([keep.id]);
    const [archived] = await loadCatalog({ q: parent.asin!, status: "ARCHIVED" });
    expect(archived!.children.map((c) => c.id)).toEqual([gone.id]);

    expect(await prisma.productVariant.count({ where: { id: gone.id, ...PICKABLE_VARIANT_WHERE } })).toBe(0);
    expect(await prisma.productVariant.count({ where: { id: gone.id } })).toBe(1);
    const history = await prisma.auditLog.findMany({ where: { entityId: gone.id }, select: { action: true } });
    expect(history.map((h) => h.action).sort()).toEqual(["catalog.child.added", "catalog.child.archived"]);
  });

  it("Test 8b: a Child that still has stock can't be archived", async () => {
    const parent = await makeParent();
    const child = await makeChild(parent.id, { Size: "Small" });
    await receiveIntoChild(child.id, 5);
    await expect(archiveChildAsin(prisma, { ...(await ownerActor()), productVariantId: child.id })).rejects.toThrow(ProductStillInUseError);
  });

  it("Test 8c: setting a Child — or its Parent — Inactive hides it from pickers, so it is blocked while stock remains", async () => {
    const owner = await ownerActor();
    const parent = await makeParent();
    const child = await makeChild(parent.id, { Size: "Small" });
    await receiveIntoChild(child.id, 5);
    await expect(updateChildAsin(prisma, { ...owner, productVariantId: child.id, status: "INACTIVE" })).rejects.toThrow(ProductStillInUseError);
    await expect(updateParentAsin(prisma, { ...owner, productId: parent.id, status: "INACTIVE" })).rejects.toThrow(ProductStillInUseError);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: child.id } })).status).toBe("ACTIVE");

    const empty = await makeParent();
    const unused = await makeChild(empty.id, { Size: "Large" });
    expect((await updateChildAsin(prisma, { ...owner, productVariantId: unused.id, status: "INACTIVE" })).status).toBe("INACTIVE");
    expect((await updateParentAsin(prisma, { ...owner, productId: empty.id, status: "INACTIVE" })).status).toBe("INACTIVE");
  });

  it("Test 9: a transaction against a Child ASIN resolves Child -> Parent -> Product", async () => {
    const parent = await makeParent("Example Hoodie");
    const child = await makeChild(parent.id, { Size: "Large", Color: "Grey" });
    const rr = await receiveIntoChild(child.id, 12);

    const ledger = await prisma.stockLedger.findFirstOrThrow({
      where: { referenceType: "ReceivingReport", referenceId: rr.id },
      include: { productVariant: { include: { product: true } } },
    });
    expect(ledger.productVariant.asin).toBe(child.asin);
    expect(ledger.productVariant.product.asin).toBe(parent.asin);
    expect(ledger.productVariant.product.name).toBe("Example Hoodie");
  });

  it("Test 10: parent-level totals add up its own Children only — never another Parent's", async () => {
    const parentA = await makeParent("Report Parent A");
    const a1 = await makeChild(parentA.id, { Size: "S" });
    const a2 = await makeChild(parentA.id, { Size: "M" });
    const parentB = await makeParent("Report Parent B");
    const b1 = await makeChild(parentB.id, { Size: "S" });
    await receiveIntoChild(a1.id, 7);
    await receiveIntoChild(a2.id, 3);
    await receiveIntoChild(b1.id, 100);

    const rows = await loadCatalog({ status: "live" });
    const rowA = rows.find((r) => r.id === parentA.id)!;
    const rowB = rows.find((r) => r.id === parentB.id)!;
    expect(rowA.children.find((c) => c.id === a1.id)!.totalUnits).toBe(7);
    expect(rowA.totalUnits).toBe(10);
    expect(rowA.liveChildCount).toBe(2);
    expect(rowB.totalUnits).toBe(100);
  });

  it("[rule] an ASIN must be exactly 10 letters or digits", async () => {
    const owner = await ownerActor();
    await expect(createParentAsin(prisma, { ...owner, asin: "B0PARENT123", productName: "Too long", baseUnitId: await unitId("PC") })).rejects.toThrow(InvalidAsinError);
  });

  it("[rule] only the Owner manages the catalog", async () => {
    const secretary = await getUserByRole(prisma, "secretary");
    await expect(createParentAsin(prisma, { actorRole: "SECRETARY", actorUserId: secretary.id, asin: newAsin(), productName: "Nope", baseUnitId: await unitId("PC") })).rejects.toThrow(PermissionDeniedError);
  });

  it("[rule] moving a Child to another Parent is logged, and is blocked across different base units", async () => {
    const owner = await ownerActor();
    const from = await makeParent("Move From");
    const to = await makeParent("Move To");
    const otherUnit = await makeParent("Packs Only", "PACK");
    const child = await makeChild(from.id, { Size: "S" });

    await expect(updateChildAsin(prisma, { ...owner, productVariantId: child.id, parentProductId: otherUnit.id })).rejects.toThrow(IncompatibleParentError);
    const moved = await updateChildAsin(prisma, { ...owner, productVariantId: child.id, parentProductId: to.id });
    expect(moved.productId).toBe(to.id);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: child.id, action: "catalog.child.parent_changed" } });
    expect(audit.afterState).toMatchObject({ parentAsin: to.asin });
  });
});
