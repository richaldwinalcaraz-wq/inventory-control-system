import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, RoleName } from "@prisma/client";
import { assertPermission } from "../../domain/rbac/assertPermission";
import type { ImportUnitCode, PriceListPlan } from "../../domain/catalog/priceListImport";

export class PriceListImportRejectedError extends Error {}

const UNIT_NAMES: Record<ImportUnitCode, string> = { SACK: "Sack", RIM: "Rim", PC: "Piece" };

export interface ApplyPriceListImportParams {
  actorRole: RoleName;
  actorUserId: string;
  sourceFile: string;
  sourceSha256: string;
  plan: PriceListPlan;
}

export interface PriceListImportSummary {
  batchId: string;
  products: number;
  variants: number;
  prices: number;
  pendingPackSizes: number;
  rowsWithIssues: number;
}

/**
 * Loads a planned price list into the catalog in one transaction: products,
 * variants, current WHOLESALE prices, PENDING pack sizes (confirmed by two
 * people on first delivery), and one import row per spreadsheet line that
 * keeps the client's original text and cells. Refuses a file that was
 * already imported, a plan with unresolved conflicts, and any product name
 * that already exists — it never merges into or overwrites live data.
 */
export async function applyPriceListImport(prisma: PrismaClient, params: ApplyPriceListImportParams): Promise<PriceListImportSummary> {
  await assertPermission(prisma, { role: params.actorRole, action: "inventory.product.create" });
  await assertPermission(prisma, { role: params.actorRole, action: "inventory.price.update" });
  if (params.plan.conflicts.length > 0) {
    throw new PriceListImportRejectedError(`The plan has ${params.plan.conflicts.length} unresolved conflict(s) — fix the grouping first: ${params.plan.conflicts[0]}`);
  }

  return prisma.$transaction(
    async (tx) => {
      if (await tx.catalogImportBatch.findUnique({ where: { sourceSha256: params.sourceSha256 } })) {
        throw new PriceListImportRejectedError(`${params.sourceFile} has already been imported.`);
      }
      const names = params.plan.products.map((p) => p.name);
      const clashes = await tx.product.findMany({ where: { name: { in: names, mode: "insensitive" } }, select: { name: true } });
      if (clashes.length > 0) {
        throw new PriceListImportRejectedError(`These products already exist, so nothing was imported: ${clashes.map((c) => c.name).join(", ")}.`);
      }

      const units = new Map<ImportUnitCode, string>();
      for (const code of Object.keys(UNIT_NAMES) as ImportUnitCode[]) {
        const unit = await tx.unitOfMeasure.upsert({ where: { code }, update: {}, create: { code, name: UNIT_NAMES[code] } });
        units.set(code, unit.id);
      }
      const unitId = (code: ImportUnitCode) => units.get(code)!;

      const categoryIds = new Map<string, string>();
      for (const name of new Set(params.plan.products.map((p) => p.category))) {
        const existing = await tx.category.findFirst({ where: { name: { equals: name, mode: "insensitive" }, status: "ACTIVE" } });
        categoryIds.set(name, existing?.id ?? (await tx.category.create({ data: { name } })).id);
      }

      const plannedSkus = params.plan.products.flatMap((p) => p.variants.map((v) => v.sku));
      const takenSkus = new Set(
        [
          ...(await tx.productVariant.findMany({ where: { sku: { in: plannedSkus } }, select: { sku: true } })),
          ...(await tx.product.findMany({ where: { sku: { in: plannedSkus } }, select: { sku: true } })),
        ].map((r) => r.sku),
      );

      const batchId = randomUUID();
      const productRows: Prisma.ProductCreateManyInput[] = [];
      const variantRows: Prisma.ProductVariantCreateManyInput[] = [];
      const priceRows: Prisma.VariantPriceCreateManyInput[] = [];
      const packRows: Prisma.ConversionRateVersionCreateManyInput[] = [];
      const importRows: Prisma.CatalogImportRowCreateManyInput[] = [];
      const audits: Prisma.AuditLogCreateManyInput[] = [];
      const source = { source: "price-list-import", batchId, file: params.sourceFile };

      for (const product of params.plan.products) {
        const productId = randomUUID();
        productRows.push({ id: productId, name: product.name, categoryId: categoryIds.get(product.category), baseUnitId: unitId(product.baseUnitCode), status: "ACTIVE" });
        audits.push({ actorId: params.actorUserId, action: "catalog.parent.created", entityType: "Product", entityId: productId, afterState: { productName: product.name, baseUnit: product.baseUnitCode, ...source } });

        for (const v of product.variants) {
          const variantId = randomUUID();
          let sku = v.sku;
          for (let n = 2; takenSkus.has(sku); n++) sku = `${v.sku.slice(0, 56)}-${n}`;
          takenSkus.add(sku);
          const basePrice = v.prices.find((p) => p.unitCode === product.baseUnitCode)?.price ?? 0;

          variantRows.push({ id: variantId, productId, sku, name: v.name, sellingPrice: basePrice, status: v.status, displayOrder: v.item.sourceRow });
          for (const p of v.prices) {
            priceRows.push({ productVariantId: variantId, unitId: unitId(p.unitCode), priceList: "WHOLESALE", price: p.price, createdBy: params.actorUserId });
          }
          for (const s of v.packSizes) {
            packRows.push({ productVariantId: variantId, fromUnitId: unitId(s.unitCode), toUnitId: unitId(product.baseUnitCode), rate: s.baseQtyPerUnit, proposedBy: params.actorUserId, status: "PENDING_VERIFICATION" });
          }
          importRows.push({
            batchId,
            sourceRow: v.item.sourceRow,
            sourceSection: v.item.section,
            originalText: v.item.originalText,
            rawCells: v.item.rawCells as Prisma.InputJsonValue,
            normalizedName: v.name,
            productId,
            productVariantId: variantId,
            issues: v.issues,
          });
          audits.push({
            actorId: params.actorUserId,
            action: "catalog.child.added",
            entityType: "ProductVariant",
            entityId: variantId,
            afterState: {
              parentProductId: productId,
              sku,
              name: v.name,
              status: v.status,
              prices: Object.fromEntries(v.prices.map((p) => [p.unitCode, p.price])),
              packSizes: Object.fromEntries(v.packSizes.map((s) => [s.unitCode, s.baseQtyPerUnit])),
              sourceRow: v.item.sourceRow,
              ...source,
            },
          });
        }
      }

      await tx.catalogImportBatch.create({ data: { id: batchId, sourceFile: params.sourceFile, sourceSha256: params.sourceSha256, importedBy: params.actorUserId, rowCount: importRows.length } });
      await tx.product.createMany({ data: productRows });
      await tx.productVariant.createMany({ data: variantRows });
      await tx.variantPrice.createMany({ data: priceRows });
      await tx.conversionRateVersion.createMany({ data: packRows });
      await tx.catalogImportRow.createMany({ data: importRows });
      await tx.auditLog.createMany({ data: audits });

      return {
        batchId,
        products: productRows.length,
        variants: variantRows.length,
        prices: priceRows.length,
        pendingPackSizes: packRows.length,
        rowsWithIssues: importRows.filter((r) => Array.isArray(r.issues) && r.issues.length > 0).length,
      };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
