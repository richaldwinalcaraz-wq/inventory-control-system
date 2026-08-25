-- G-08/BPD sec.12.1: prevents two concurrently-started cycle counts against
-- the same product+location. This is a "don't allow a duplicate open row"
-- guarantee, not a shared-aggregate computation, so a partial unique index
-- is sufficient — no FOR UPDATE lock needed. Deliberately absent from
-- schema.prisma (Prisma's schema language can't express a WHERE clause on
-- @@unique), same as stock_ledger_one_opening_balance_per_product.
CREATE UNIQUE INDEX cycle_count_record_one_open_per_product_location
ON cycle_count_record (product_variant_id, warehouse_location_id)
WHERE status NOT IN ('CLOSED_CLEAN', 'VARIANCE_CONFIRMED');