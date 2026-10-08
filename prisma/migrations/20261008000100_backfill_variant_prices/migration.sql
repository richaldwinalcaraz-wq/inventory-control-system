-- Every variant created before per-unit pricing has exactly one price,
-- product_variant.selling_price, which was always "per base unit". Carry it
-- over as the variant's current all-branch WHOLESALE price for its base
-- unit, so existing items stay priced. created_by marks it as system-made.
INSERT INTO "variant_price" ("id", "product_variant_id", "unit_id", "price_list", "branch_id", "price", "created_by")
SELECT gen_random_uuid()::text, v."id", p."base_unit_id", 'WHOLESALE', NULL, v."selling_price", 'system:backfill-20261008'
FROM "product_variant" v
JOIN "product" p ON p."id" = v."product_id"
WHERE v."selling_price" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "variant_price" vp
    WHERE vp."product_variant_id" = v."id" AND vp."unit_id" = p."base_unit_id"
      AND vp."price_list" = 'WHOLESALE' AND vp."branch_id" IS NULL AND vp."superseded_at" IS NULL
  );
