-- CreateTable
CREATE TABLE "billing_orders" (
    "id" SERIAL NOT NULL,
    "invoice_no" TEXT NOT NULL,
    "client_id" INTEGER NOT NULL,
    "representative_id" INTEGER NOT NULL,
    "created_date" DATE,
    "order_date" DATE NOT NULL,
    "account" TEXT,
    "subtotal" DECIMAL(12,2),
    "tax" DECIMAL(12,2),
    "tip" DECIMAL(12,2),
    "fee" DECIMAL(12,2),
    "discount" DECIMAL(12,2),
    "total" DECIMAL(12,2) NOT NULL,
    "upload_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_matches" (
    "client_id" INTEGER NOT NULL,
    "phone_no10" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "company" TEXT,
    "title" TEXT,
    "candidates" TEXT,
    "source" TEXT NOT NULL DEFAULT 'reference-import',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_matches_pkey" PRIMARY KEY ("client_id","phone_no10")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_orders_invoice_no_key" ON "billing_orders"("invoice_no");

-- CreateIndex
CREATE INDEX "billing_orders_order_date_idx" ON "billing_orders"("order_date");

-- CreateIndex
CREATE INDEX "billing_orders_client_id_order_date_idx" ON "billing_orders"("client_id", "order_date");

-- CreateIndex
CREATE INDEX "billing_orders_representative_id_order_date_idx" ON "billing_orders"("representative_id", "order_date");
