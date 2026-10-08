-- Variants list in the client's own price-list order (Tiny, Medium, Large),
-- not alphabetically (which puts "10 oz" before "2 oz").
ALTER TABLE "product_variant" ADD COLUMN "display_order" INTEGER;

-- Variants already imported from the price list take their spreadsheet row.
UPDATE "product_variant" v
SET "display_order" = r."source_row"
FROM "catalog_import_row" r
WHERE r."product_variant_id" = v."id" AND v."display_order" IS NULL;
