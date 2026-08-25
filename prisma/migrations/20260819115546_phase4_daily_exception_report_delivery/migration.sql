-- CreateTable
CREATE TABLE "daily_exception_report_delivery" (
    "id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "channel" TEXT NOT NULL,
    "dispatched_at" TIMESTAMP(3),
    "delivery_status" TEXT NOT NULL,
    "generated_content_hash" TEXT NOT NULL,
    "triggered_by" TEXT,

    CONSTRAINT "daily_exception_report_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_exception_report_delivery_business_date_channel_key" ON "daily_exception_report_delivery"("business_date", "channel");
