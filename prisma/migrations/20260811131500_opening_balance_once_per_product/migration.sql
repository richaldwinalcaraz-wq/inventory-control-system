-- BR-064: Opening Balance is allowed once per product per branch, ever —
-- never a repeatable transaction type. A partial unique index is the real
-- guarantee (race-safe at the DB layer); the application layer also
-- pre-checks for a friendlier error, but this index is what actually
-- prevents two concurrent Opening Balance posts for the same product from
-- both succeeding.
CREATE UNIQUE INDEX stock_ledger_one_opening_balance_per_product
ON stock_ledger (branch_id, product_variant_id)
WHERE movement_type = 'OPENING_BALANCE';
