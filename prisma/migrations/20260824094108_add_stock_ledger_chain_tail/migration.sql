-- CreateTable
CREATE TABLE "stock_ledger_chain_tail" (
    "id" INTEGER NOT NULL,
    "sequence_no" BIGINT NOT NULL DEFAULT 0,
    "row_hash" CHAR(64) NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',

    CONSTRAINT "stock_ledger_chain_tail_pkey" PRIMARY KEY ("id")
);
