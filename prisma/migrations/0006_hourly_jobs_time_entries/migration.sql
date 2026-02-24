-- Hourly billing fields on jobs
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "chargeByHour" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "hourlyRateCents" INTEGER;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "billableMinutesTotal" INTEGER NOT NULL DEFAULT 0;

-- Time entry enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TimeEntrySource') THEN
    CREATE TYPE "TimeEntrySource" AS ENUM ('TIMER', 'MANUAL');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TimeEntryStatus') THEN
    CREATE TYPE "TimeEntryStatus" AS ENUM ('ACTIVE', 'STOPPED');
  END IF;
END $$;

-- Time entries table
CREATE TABLE IF NOT EXISTS "time_entries" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "workerId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "durationMinutes" INTEGER NOT NULL DEFAULT 0,
  "source" "TimeEntrySource" NOT NULL DEFAULT 'TIMER',
  "status" "TimeEntryStatus" NOT NULL DEFAULT 'ACTIVE',
  "note" TEXT,
  "editedReason" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "time_entries_tenantId_jobId_idx" ON "time_entries"("tenantId", "jobId");
CREATE INDEX IF NOT EXISTS "time_entries_tenantId_workerId_idx" ON "time_entries"("tenantId", "workerId");
CREATE INDEX IF NOT EXISTS "time_entries_jobId_createdAt_idx" ON "time_entries"("jobId", "createdAt");
CREATE INDEX IF NOT EXISTS "time_entries_tenantId_status_idx" ON "time_entries"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "time_entries_tenantId_deletedAt_idx" ON "time_entries"("tenantId", "deletedAt");

ALTER TABLE "time_entries"
  ADD CONSTRAINT "time_entries_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "time_entries"
  ADD CONSTRAINT "time_entries_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "jobs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "time_entries"
  ADD CONSTRAINT "time_entries_workerId_fkey"
  FOREIGN KEY ("workerId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "time_entries"
  ADD CONSTRAINT "time_entries_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "time_entries"
  ADD CONSTRAINT "time_entries_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only one active timer per tenant/job/worker at any point in time.
CREATE UNIQUE INDEX IF NOT EXISTS "time_entries_active_unique_idx"
  ON "time_entries"("tenantId", "jobId", "workerId")
  WHERE "status" = 'ACTIVE' AND "deletedAt" IS NULL;
