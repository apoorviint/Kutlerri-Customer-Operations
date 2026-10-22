-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "ClientKind" AS ENUM ('CUSTOMER', 'INTERNAL');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ClientKind" NOT NULL DEFAULT 'CUSTOMER',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "representatives" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "representatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "representative_id" INTEGER,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apollo_client_map" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "client_id" INTEGER NOT NULL,

    CONSTRAINT "apollo_client_map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_timezone_rules" (
    "id" SERIAL NOT NULL,
    "agent_key" TEXT,
    "line_no10" TEXT,
    "zone" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "note" TEXT,

    CONSTRAINT "call_timezone_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "calls" (
    "id" TEXT NOT NULL,
    "contact_no10" TEXT,
    "justcall_no10" TEXT,
    "line_name" TEXT,
    "agent_id" INTEGER,
    "recording_url" TEXT,
    "duration_sec" INTEGER NOT NULL DEFAULT 0,
    "local_date" DATE NOT NULL,
    "local_time" TEXT NOT NULL,
    "tz_used" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "shift_date" DATE NOT NULL,
    "disposition_raw" TEXT,
    "disposition_key" TEXT,
    "provider_synced_at" TIMESTAMP(3),
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB NOT NULL,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emails" (
    "id" TEXT NOT NULL,
    "mailbox" TEXT,
    "sender_domain" TEXT,
    "client_id" INTEGER,
    "sequence" TEXT,
    "sequence_id" TEXT,
    "step" INTEGER,
    "template" TEXT,
    "to_email" TEXT,
    "to_name" TEXT,
    "to_company" TEXT,
    "subject" TEXT,
    "sent_at" TIMESTAMP(3),
    "sent_date_pacific" DATE,
    "scheduled_at" TIMESTAMP(3),
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "bounced" BOOLEAN NOT NULL DEFAULT false,
    "opened" BOOLEAN NOT NULL DEFAULT false,
    "clicked" BOOLEAN NOT NULL DEFAULT false,
    "unsubscribed" BOOLEAN NOT NULL DEFAULT false,
    "replied" BOOLEAN NOT NULL DEFAULT false,
    "contact_stage" TEXT,
    "body_html" TEXT,
    "reply_text" TEXT,
    "provider_synced_at" TIMESTAMP(3),
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB NOT NULL,

    CONSTRAINT "emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "window_from" DATE,
    "window_to" DATE,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "details" JSONB,
    "triggered_by" TEXT NOT NULL DEFAULT 'schedule',

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_locks" (
    "name" TEXT NOT NULL,
    "locked_at" TIMESTAMP(3) NOT NULL,
    "locked_by" TEXT NOT NULL,

    CONSTRAINT "job_locks_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "clients_name_key" ON "clients"("name");

-- CreateIndex
CREATE UNIQUE INDEX "representatives_name_key" ON "representatives"("name");

-- CreateIndex
CREATE UNIQUE INDEX "agents_key_key" ON "agents"("key");

-- CreateIndex
CREATE UNIQUE INDEX "apollo_client_map_kind_value_key" ON "apollo_client_map"("kind", "value");

-- CreateIndex
CREATE INDEX "calls_shift_date_idx" ON "calls"("shift_date");

-- CreateIndex
CREATE INDEX "calls_occurred_at_idx" ON "calls"("occurred_at");

-- CreateIndex
CREATE INDEX "calls_agent_id_idx" ON "calls"("agent_id");

-- CreateIndex
CREATE INDEX "calls_justcall_no10_idx" ON "calls"("justcall_no10");

-- CreateIndex
CREATE INDEX "emails_sent_date_pacific_idx" ON "emails"("sent_date_pacific");

-- CreateIndex
CREATE INDEX "emails_client_id_sent_date_pacific_idx" ON "emails"("client_id", "sent_date_pacific");

-- CreateIndex
CREATE INDEX "emails_sender_domain_idx" ON "emails"("sender_domain");

-- CreateIndex
CREATE INDEX "sync_runs_source_started_at_idx" ON "sync_runs"("source", "started_at");

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_representative_id_fkey" FOREIGN KEY ("representative_id") REFERENCES "representatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apollo_client_map" ADD CONSTRAINT "apollo_client_map_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emails" ADD CONSTRAINT "emails_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
