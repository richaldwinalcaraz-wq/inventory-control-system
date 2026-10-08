-- Parent ASIN = product, Child ASIN = product_variant (src/server/domain/catalog/asin.ts).
-- Additive only: existing products keep working with a null ASIN.
-- AlterTable
ALTER TABLE "product" ADD COLUMN     "asin" TEXT,
ADD COLUMN     "brand" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "sku" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "product_variant" ADD COLUMN     "asin" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "variation_data" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "product_asin_key" ON "product"("asin");

-- CreateIndex
CREATE UNIQUE INDEX "product_sku_key" ON "product"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_variant_asin_key" ON "product_variant"("asin");

