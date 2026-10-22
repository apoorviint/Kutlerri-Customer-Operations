-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "details" JSONB,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_batches" (
    "id" SERIAL NOT NULL,
    "client_id" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_hash" TEXT,
    "file_key" TEXT,
    "uploaded_by" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'processing',
    "replace" BOOLEAN NOT NULL DEFAULT false,
    "superseded_by_id" INTEGER,
    "rows_read" INTEGER NOT NULL DEFAULT 0,
    "phones_indexed" INTEGER NOT NULL DEFAULT 0,
    "newly_matched" INTEGER NOT NULL DEFAULT 0,
    "progress" JSONB,
    "sheets" JSONB,
    "error" TEXT,

    CONSTRAINT "prospect_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_phones" (
    "id" BIGSERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "phone_no10" TEXT NOT NULL,
    "name" TEXT,
    "title" TEXT,
    "company" TEXT,

    CONSTRAINT "prospect_phones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_uploads" (
    "id" SERIAL NOT NULL,
    "file_name" TEXT,
    "file_hash" TEXT,
    "file_key" TEXT,
    "uploaded_by" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'committed',
    "rolled_back_at" TIMESTAMP(3),
    "rolled_back_by" TEXT,
    "summary" JSONB,

    CONSTRAINT "billing_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_changes" (
    "id" SERIAL NOT NULL,
    "upload_id" INTEGER NOT NULL,
    "invoice_no" TEXT NOT NULL,
    "before" JSONB,

    CONSTRAINT "billing_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at");

-- CreateIndex
CREATE INDEX "prospect_batches_client_id_idx" ON "prospect_batches"("client_id");

-- CreateIndex
CREATE INDEX "prospect_phones_client_id_phone_no10_idx" ON "prospect_phones"("client_id", "phone_no10");

-- CreateIndex
CREATE INDEX "prospect_phones_batch_id_idx" ON "prospect_phones"("batch_id");

-- CreateIndex
CREATE INDEX "billing_changes_upload_id_idx" ON "billing_changes"("upload_id");
