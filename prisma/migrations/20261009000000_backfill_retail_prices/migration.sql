-- Retail sales used to charge product_variant.selling_price, so for every
-- variant that existed before the per-unit price list, that value IS its
-- retail list price. Carry it over as the current all-branch RETAIL price for
-- the base unit. Variants created by the client price-list import are left
-- alone: their selling_price mirrors a wholesale price, and inventing a retail
-- price from it would be wrong — the Owner sets those.
INSERT INTO "variant_price" ("id", "product_variant_id", "unit_id", "price_list", "branch_id", "price", "created_by")
SELECT gen_random_uuid()::text, v."id", p."base_unit_id", 'RETAIL', NULL, v."selling_price", 'system:backfill-20261009'
FROM "product_variant" v
JOIN "product" p ON p."id" = v."product_id"
WHERE v."selling_price" > 0
  AND NOT EXISTS (SELECT 1 FROM "catalog_import_row" r WHERE r."product_variant_id" = v."id")
  AND NOT EXISTS (
    SELECT 1 FROM "variant_price" vp
    WHERE vp."product_variant_id" = v."id" AND vp."unit_id" = p."base_unit_id"
      AND vp."price_list" = 'RETAIL' AND vp."branch_id" IS NULL AND vp."superseded_at" IS NULL
  );
