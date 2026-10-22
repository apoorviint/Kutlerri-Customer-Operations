-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'VIEWER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "contactNo" TEXT,
    "justcallNo" TEXT,
    "justcallNoName" TEXT,
    "agentName" TEXT,
    "recordingUrl" TEXT,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "disposition" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Email" (
    "id" TEXT NOT NULL,
    "sequence" TEXT,
    "sequenceId" TEXT,
    "step" INTEGER,
    "template" TEXT,
    "fromEmail" TEXT,
    "toEmail" TEXT,
    "fromName" TEXT,
    "toName" TEXT,
    "subject" TEXT,
    "sentAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "bounce" BOOLEAN NOT NULL DEFAULT false,
    "open" BOOLEAN NOT NULL DEFAULT false,
    "click" BOOLEAN NOT NULL DEFAULT false,
    "unsubscribe" BOOLEAN NOT NULL DEFAULT false,
    "replied" BOOLEAN NOT NULL DEFAULT false,
    "contactId" TEXT,
    "accountId" TEXT,
    "toCompany" TEXT,
    "contactStage" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Email_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "full" BOOLEAN NOT NULL DEFAULT false,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "emails" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Call_startedAt_idx" ON "Call"("startedAt");

-- CreateIndex
CREATE INDEX "Call_agentName_idx" ON "Call"("agentName");

-- CreateIndex
CREATE INDEX "Email_sentAt_idx" ON "Email"("sentAt");

-- CreateIndex
CREATE INDEX "Email_sequence_idx" ON "Email"("sequence");

-- CreateIndex
CREATE INDEX "Email_contactStage_idx" ON "Email"("contactStage");
