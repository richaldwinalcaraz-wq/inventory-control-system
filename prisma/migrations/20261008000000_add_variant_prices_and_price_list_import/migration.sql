-- Per-unit price list (Product -> Variant -> Unit -> Price) and the client price-list import trail.
-- CreateEnum
CREATE TYPE "PriceList" AS ENUM ('WHOLESALE', 'RETAIL');

-- CreateTable
CREATE TABLE "variant_price" (
    "id" TEXT NOT NULL,
    "product_variant_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "price_list" "PriceList" NOT NULL DEFAULT 'WHOLESALE',
    "branch_id" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variant_price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_import_batch" (
    "id" TEXT NOT NULL,
    "source_file" TEXT NOT NULL,
    "source_sha256" TEXT NOT NULL,
    "imported_by" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_import_row" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "source_row" INTEGER NOT NULL,
    "source_section" TEXT,
    "original_text" TEXT NOT NULL,
    "raw_cells" JSONB NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "product_id" TEXT,
    "product_variant_id" TEXT,
    "issues" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_import_row_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "variant_price_product_variant_id_unit_id_price_list_idx" ON "variant_price"("product_variant_id", "unit_id", "price_list");

-- CreateIndex
CREATE INDEX "variant_price_unit_id_idx" ON "variant_price"("unit_id");

-- CreateIndex
CREATE INDEX "variant_price_branch_id_idx" ON "variant_price"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_import_batch_source_sha256_key" ON "catalog_import_batch"("source_sha256");

-- CreateIndex
CREATE INDEX "catalog_import_row_product_variant_id_idx" ON "catalog_import_row"("product_variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_import_row_batch_id_source_row_key" ON "catalog_import_row"("batch_id", "source_row");

-- AddForeignKey
ALTER TABLE "variant_price" ADD CONSTRAINT "variant_price_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_price" ADD CONSTRAINT "variant_price_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_price" ADD CONSTRAINT "variant_price_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_import_row" ADD CONSTRAINT "catalog_import_row_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "catalog_import_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_import_row" ADD CONSTRAINT "catalog_import_row_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (Prisma's DSL can't express a partial expression index — see
-- the note at the top of schema.prisma): at most one CURRENT price per
-- variant + unit + price list + branch scope. NULL branch_id ("all
-- branches") is folded to '' so two all-branch rows also collide.
CREATE UNIQUE INDEX "variant_price_one_current_key"
  ON "variant_price" ("product_variant_id", "unit_id", "price_list", COALESCE("branch_id", ''))
  WHERE "superseded_at" IS NULL;

-- Units the client's price list sells in.
INSERT INTO "unit_of_measure" ("id", "code", "name") VALUES
  (gen_random_uuid()::text, 'SACK', 'Sack'),
  (gen_random_uuid()::text, 'RIM', 'Rim')
ON CONFLICT ("code") DO NOTHING;
