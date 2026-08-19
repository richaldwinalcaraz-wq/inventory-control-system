-- CreateIndex
CREATE INDEX "adjustment_request_requested_by_created_at_idx" ON "adjustment_request"("requested_by", "created_at");

-- CreateIndex
CREATE INDEX "adjustment_request_product_variant_id_warehouse_location_id_idx" ON "adjustment_request"("product_variant_id", "warehouse_location_id", "created_at");
