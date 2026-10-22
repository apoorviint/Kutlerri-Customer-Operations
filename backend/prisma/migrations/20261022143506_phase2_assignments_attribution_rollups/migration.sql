-- CreateTable
CREATE TABLE "assignment_uploads" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "file_name" TEXT,
    "file_hash" TEXT,
    "uploaded_by" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'committed',
    "rolled_back_at" TIMESTAMP(3),
    "rolled_back_by" TEXT,
    "summary" JSONB,

    CONSTRAINT "assignment_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_assignments" (
    "id" SERIAL NOT NULL,
    "phone_no10" TEXT NOT NULL,
    "representative_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "granularity" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "upload_id" INTEGER NOT NULL,
    "superseded_by_upload_id" INTEGER,
    "note" TEXT,

    CONSTRAINT "line_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_attribution" (
    "call_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "client_id" INTEGER,
    "representative_id" INTEGER,
    "assignment_id" INTEGER,
    "reason" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_attribution_pkey" PRIMARY KEY ("call_id")
);

-- CreateTable
CREATE TABLE "daily_rollups" (
    "id" SERIAL NOT NULL,
    "shift_date" DATE NOT NULL,
    "client_id" INTEGER NOT NULL,
    "representative_id" INTEGER NOT NULL,
    "agent_id" INTEGER,
    "line_no10" TEXT,
    "calls" INTEGER NOT NULL,
    "meaningful" INTEGER NOT NULL,
    "mql_over_90" INTEGER NOT NULL,
    "d_mql" INTEGER NOT NULL,
    "d_interested" INTEGER NOT NULL,
    "d_callback" INTEGER NOT NULL,
    "d_not_interested" INTEGER NOT NULL,
    "d_wrong_number" INTEGER NOT NULL,
    "d_mql_fu" INTEGER NOT NULL,
    "d_dnc" INTEGER NOT NULL,
    "d_no_answer" INTEGER NOT NULL,
    "d_bad_number" INTEGER NOT NULL,
    "d_voicemail" INTEGER NOT NULL,
    "d_meeting" INTEGER NOT NULL,
    "d_blank" INTEGER NOT NULL,
    "d_other" INTEGER NOT NULL,

    CONSTRAINT "daily_rollups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "line_assignments_phone_no10_valid_from_idx" ON "line_assignments"("phone_no10", "valid_from");

-- CreateIndex
CREATE INDEX "line_assignments_upload_id_idx" ON "line_assignments"("upload_id");

-- CreateIndex
CREATE INDEX "call_attribution_status_idx" ON "call_attribution"("status");

-- CreateIndex
CREATE INDEX "call_attribution_client_id_representative_id_idx" ON "call_attribution"("client_id", "representative_id");

-- CreateIndex
CREATE INDEX "daily_rollups_shift_date_idx" ON "daily_rollups"("shift_date");

-- CreateIndex
CREATE INDEX "daily_rollups_client_id_shift_date_idx" ON "daily_rollups"("client_id", "shift_date");

-- CreateIndex
CREATE INDEX "daily_rollups_representative_id_shift_date_idx" ON "daily_rollups"("representative_id", "shift_date");

-- AddForeignKey
ALTER TABLE "line_assignments" ADD CONSTRAINT "line_assignments_representative_id_fkey" FOREIGN KEY ("representative_id") REFERENCES "representatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_assignments" ADD CONSTRAINT "line_assignments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_assignments" ADD CONSTRAINT "line_assignments_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "assignment_uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_attribution" ADD CONSTRAINT "call_attribution_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
